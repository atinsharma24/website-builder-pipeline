/**
 * Pipeline orchestrator.
 *
 *   validate -> architect -> builder -> quality gate -> upload
 *
 * Design rules that hold everywhere in this file:
 *
 * 1. Dependencies are injected. The orchestrator never imports an SDK, the
 *    file system layout or Supabase directly, so every path through it can be
 *    exercised in a unit test with fakes.
 * 2. Stages return `Result`. Expected failures are values, not exceptions.
 * 3. Model output is untrusted. The Architect's JSON is schema checked, and
 *    the Builder's HTML must pass a deterministic gate before it is uploaded.
 * 4. Runs are idempotent. An identical request is answered from the earlier
 *    run instead of calling the models and uploading again.
 * 5. Every run leaves a record with its stage, timings and LLM attempts.
 */
import fs from "node:fs/promises";
import { mockArchitect, runArchitect } from "../agents/architect.js";
import { mockBuilder, runBuilder } from "../agents/builder.js";
import type { Logger } from "../core/logger.js";
import { err, messageOf, ok, pipelineError, type PipelineError, type Result } from "../core/result.js";
import type { AttemptRecord, LlmClient } from "../llm/types.js";
import {
    describeErrors,
    requiredSectionIdsOf,
    validateHtml,
    type HtmlReport,
    type HtmlValidationOptions,
} from "../quality/html-validator.js";
import { computeIdempotencyKey } from "../runs/idempotency.js";
import type { RunRecord, RunStage, RunStore } from "../runs/run-store.js";
import { ArchitectOutputSchema, type ArchitectOutput } from "../schemas/architect-output.js";
import { BusinessInputSchema, type BusinessInput } from "../schemas/business-input.js";
import {
    createErrorResult,
    createSuccessResult,
    type PipelineResult,
} from "../schemas/pipeline-result.js";
import { isSafeRunId, isSafeSlug, resolveInside } from "../security/path-safety.js";
import { slugify } from "../services/slugify.js";

/**
 * Pipeline options
 */
export interface PipelineOptions {
    useMock?: boolean; // Use mock agents instead of real LLM
    skipUpload?: boolean; // Skip Supabase upload (for local testing)
    outputDir?: string; // Local directory to save HTML (optional)
    retryRunId?: string; // Previous run ID to recover architect spec from
    retrySlug?: string; // Business slug of the previous run
    force?: boolean; // Ignore any earlier identical run and generate again
    clientKey?: string; // Value of the Idempotency-Key header, if the caller sent one
}

export interface UploadOutcome {
    success: boolean;
    publicUrl?: string;
    storagePath?: string;
    sizeBytes?: number;
    error?: string;
}

/** The storage operations the pipeline needs. Supabase implements this in production. */
export interface Uploader {
    checkBucketExists(): Promise<boolean>;
    uploadWebsite(
        businessSlug: string,
        htmlContent: string,
        runId: string,
        architectPrompt?: string
    ): Promise<UploadOutcome>;
}

export interface PipelineSettings {
    /** Extra Builder calls allowed when the HTML fails the quality gate. */
    readonly maxRepairAttempts: number;
    /** How long a successful run can answer identical requests. 0 disables replay. */
    readonly idempotencyTtlMs: number;
    readonly htmlOptions?: Partial<HtmlValidationOptions>;
}

export interface PipelineDeps {
    readonly architectLlm: LlmClient;
    readonly builderLlm: LlmClient;
    readonly store: RunStore;
    readonly uploader: Uploader;
    readonly logger: Logger;
    readonly now: () => number;
    readonly newRunId: () => string;
    readonly settings: PipelineSettings;
}

export interface Pipeline {
    run(rawInput: unknown, options?: PipelineOptions): Promise<PipelineResult>;
}

/** Wrap an LLM client so every attempt it makes is appended to `sink`. */
function recording(inner: LlmClient, sink: AttemptRecord[]): LlmClient {
    return {
        async generate(prompt) {
            const response = await inner.generate(prompt);
            sink.push(...(response.ok ? response.value.attempts : response.error.attempts));
            return response;
        },
    };
}

function formatIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
    return issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join("; ");
}

export function createPipeline(deps: PipelineDeps): Pipeline {
    const { store, uploader, logger, now, settings } = deps;

    /**
     * Requests that are being generated right now, by idempotency key.
     * A second identical request joins the first one's promise instead of
     * starting a duplicate run. This is the single flight pattern.
     */
    const inFlight = new Map<string, Promise<PipelineResult>>();

    async function persist(record: RunRecord): Promise<void> {
        record.updatedAt = new Date(now()).toISOString();
        try {
            await store.save(record);
        } catch (cause) {
            // Losing a run record must never fail the run itself.
            logger.warn({ runId: record.runId, cause: messageOf(cause) }, "could not persist run record");
        }
    }

    /** Run one stage, record how long it took, and persist the new stage name. */
    async function stage<T>(
        record: RunRecord,
        name: RunStage,
        work: () => Promise<Result<T, PipelineError>>
    ): Promise<Result<T, PipelineError>> {
        record.stage = name;
        await persist(record);
        const startedAt = now();
        let outcome: Result<T, PipelineError>;
        try {
            outcome = await work();
        } catch (cause) {
            // A stage should return err, but a bug or an SDK may still throw.
            outcome = err(
                pipelineError(
                    name === "done" || name === "validation" ? "validation" : name,
                    "UNEXPECTED_EXCEPTION",
                    messageOf(cause)
                )
            );
        }
        const elapsed = now() - startedAt;
        record.stageTimingsMs[name] = (record.stageTimingsMs[name] ?? 0) + elapsed;
        logger.info(
            { runId: record.runId, stage: name, ms: elapsed, ok: outcome.ok },
            outcome.ok ? "stage finished" : "stage failed"
        );
        return outcome;
    }

    async function loadSpecForRecovery(
        options: PipelineOptions
    ): Promise<Result<ArchitectOutput, PipelineError>> {
        const { retrySlug, retryRunId, outputDir } = options;
        if (outputDir === undefined) {
            return err(pipelineError("architect", "RECOVERY_UNAVAILABLE", "Recovery needs an output directory"));
        }
        // These two values come from the query string and become path segments.
        if (!isSafeSlug(retrySlug) || !isSafeRunId(retryRunId)) {
            return err(pipelineError("architect", "RECOVERY_BAD_REFERENCE", "retrySlug or retryRunId is not valid"));
        }
        const specPath = resolveInside(outputDir, retrySlug, retryRunId, "architect-spec.json");
        if (specPath === undefined) {
            return err(pipelineError("architect", "RECOVERY_BAD_REFERENCE", "Recovery path escapes the output directory"));
        }
        let raw: string;
        try {
            raw = await fs.readFile(specPath, "utf-8");
        } catch {
            return err(
                pipelineError("architect", "RECOVERY_SPEC_NOT_FOUND", `No saved architect spec for run ${retryRunId}`)
            );
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return err(pipelineError("architect", "RECOVERY_SPEC_INVALID", "Saved architect spec is not valid JSON"));
        }
        const validation = ArchitectOutputSchema.safeParse(parsed);
        if (!validation.success) {
            return err(
                pipelineError(
                    "architect",
                    "RECOVERY_SPEC_INVALID",
                    `Saved architect spec is invalid. ${formatIssues(validation.error.issues)}`
                )
            );
        }
        return ok(validation.data);
    }

    async function saveLocally(
        options: PipelineOptions,
        record: RunRecord,
        fileName: string,
        content: string
    ): Promise<void> {
        if (options.outputDir === undefined) return;
        const dir = resolveInside(options.outputDir, record.businessSlug, record.runId);
        if (dir === undefined) return;
        try {
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(`${dir}/${fileName}`, content, "utf-8");
        } catch (cause) {
            // The local copy is a convenience for recovery. It must not fail the run.
            logger.warn({ runId: record.runId, cause: messageOf(cause) }, `could not save ${fileName} locally`);
        }
    }

    async function execute(
        input: BusinessInput,
        options: PipelineOptions,
        runId: string,
        idempotencyKey: string
    ): Promise<PipelineResult> {
        const startedIso = new Date(now()).toISOString();
        const record: RunRecord = {
            runId,
            idempotencyKey,
            businessSlug: slugify(input.business_name),
            status: "running",
            stage: "architect",
            createdAt: startedIso,
            updatedAt: startedIso,
            stageTimingsMs: {},
            llmAttempts: [],
            repairAttempts: 0,
        };
        const architectLlm = recording(deps.architectLlm, record.llmAttempts);
        const builderLlm = recording(deps.builderLlm, record.llmAttempts);

        const finish = async (result: PipelineResult): Promise<PipelineResult> => {
            record.status = result.status === "success" ? "succeeded" : "failed";
            record.stage = "done";
            record.result = result;
            await persist(record);
            return result;
        };
        const fail = (error: PipelineError): Promise<PipelineResult> =>
            finish(
                createErrorResult({
                    run_id: runId,
                    business_slug: record.businessSlug,
                    error_message: error.message,
                    error_phase: error.phase,
                    error_code: error.code,
                    retryable: error.retryable,
                    repair_attempts: record.repairAttempts,
                })
            );

        // ---- Architect (or recovery of a saved spec) --------------------
        const isRecovery = options.retryRunId !== undefined || options.retrySlug !== undefined;
        const specResult = await stage(record, "architect", async () => {
            if (isRecovery) return loadSpecForRecovery(options);
            if (options.useMock === true) return ok(mockArchitect(input));
            const produced = await runArchitect(input, architectLlm, {
                maxRepairAttempts: settings.maxRepairAttempts,
            });
            if (!produced.ok) return produced;
            if (produced.value.degraded) {
                logger.warn({ runId }, "architect output was not valid JSON, using raw text as the prompt");
            }
            return ok(produced.value.value);
        });
        if (!specResult.ok) return fail(specResult.error);
        const spec = specResult.value;
        if (!isRecovery) {
            await saveLocally(options, record, "architect-spec.json", JSON.stringify(spec, null, 2));
        }

        // ---- Builder with quality gate and bounded repair ---------------
        const htmlOptions: Partial<HtmlValidationOptions> = {
            ...settings.htmlOptions,
            requiredSectionIds: requiredSectionIdsOf(spec),
        };
        // The mock builder is deterministic, so asking it again cannot change the outcome.
        const maxRounds = options.useMock === true ? 0 : settings.maxRepairAttempts;
        let html = "";
        let report: HtmlReport | undefined;
        let repairNotes: string | undefined;

        for (let round = 0; round <= maxRounds; round++) {
            const built = await stage(record, "builder", async () => {
                if (options.useMock === true) return ok(mockBuilder(spec));
                const produced = await runBuilder(spec, builderLlm, repairNotes);
                return produced.ok ? ok(produced.value.value) : produced;
            });
            if (!built.ok) return fail(built.error);
            html = built.value;

            const checked = await stage(record, "quality", async () => ok(validateHtml(html, htmlOptions)));
            if (!checked.ok) return fail(checked.error);
            report = checked.value;
            if (report.ok) break;

            repairNotes = describeErrors(report);
            if (round < maxRounds) {
                record.repairAttempts += 1;
                logger.warn({ runId, round: round + 1, problems: repairNotes }, "html failed the quality gate, asking for a repair");
            }
        }

        if (report === undefined || !report.ok) {
            return fail(
                pipelineError(
                    "quality",
                    "HTML_QUALITY_GATE_FAILED",
                    `Generated HTML failed the quality gate after ${record.repairAttempts} repair attempt(s): ${repairNotes ?? "unknown problem"}`,
                    true
                )
            );
        }
        const warnings = report.issues
            .filter((issue) => issue.severity === "warning")
            .map((issue) => issue.message);
        await saveLocally(options, record, "index.html", html);

        // ---- Upload ------------------------------------------------------
        if (options.skipUpload === true) {
            return finish(
                createSuccessResult({
                    run_id: runId,
                    business_slug: record.businessSlug,
                    html_size_bytes: report.sizeBytes,
                    warnings,
                    repair_attempts: record.repairAttempts,
                })
            );
        }

        const uploaded = await stage(record, "upload", async () => {
            if (!(await uploader.checkBucketExists())) {
                logger.warn({ runId }, "bucket check failed, attempting the upload anyway");
            }
            const outcome = await uploader.uploadWebsite(
                record.businessSlug,
                html,
                runId,
                spec.website_generation_prompt
            );
            if (!outcome.success || outcome.publicUrl === undefined || outcome.storagePath === undefined) {
                return err(
                    pipelineError("upload", "UPLOAD_FAILED", `Upload failed: ${outcome.error ?? "unknown error"}`, true)
                );
            }
            return ok({ publicUrl: outcome.publicUrl, storagePath: outcome.storagePath });
        });
        if (!uploaded.ok) return fail(uploaded.error);

        return finish(
            createSuccessResult({
                run_id: runId,
                business_slug: record.businessSlug,
                html_size_bytes: report.sizeBytes,
                storage_path: uploaded.value.storagePath,
                public_url: uploaded.value.publicUrl,
                warnings,
                repair_attempts: record.repairAttempts,
            })
        );
    }

    /** Answer from an earlier identical run when there is a fresh successful one. */
    async function replayOrExecute(
        input: BusinessInput,
        options: PipelineOptions,
        runId: string,
        idempotencyKey: string
    ): Promise<PipelineResult> {
        if (settings.idempotencyTtlMs > 0) {
            const previous = await store.findLatestByKey(idempotencyKey).catch(() => undefined);
            if (
                previous?.status === "succeeded" &&
                previous.result !== undefined &&
                now() - Date.parse(previous.createdAt) <= settings.idempotencyTtlMs
            ) {
                logger.info({ runId, replayOf: previous.runId }, "identical request, replaying the earlier result");
                return { ...previous.result, idempotent_replay: true };
            }
        }
        return execute(input, options, runId, idempotencyKey);
    }

    async function run(rawInput: unknown, options: PipelineOptions = {}): Promise<PipelineResult> {
        const runId = deps.newRunId();

        // ---- Validation --------------------------------------------------
        const validation = BusinessInputSchema.safeParse(rawInput);
        if (!validation.success) {
            const details = formatIssues(validation.error.issues);
            logger.warn({ runId, details }, "input validation failed");
            return createErrorResult({
                run_id: runId,
                error_message: `Validation failed: ${details}`,
                error_phase: "validation",
                error_code: "INVALID_INPUT",
                retryable: false,
            });
        }
        const input = validation.data;

        const idempotencyKey = computeIdempotencyKey(input, {
            useMock: options.useMock === true,
            skipUpload: options.skipUpload === true,
            ...(options.clientKey !== undefined ? { clientKey: options.clientKey } : {}),
        });

        // An explicit retry or force always generates again.
        const bypass =
            options.force === true || options.retryRunId !== undefined || options.retrySlug !== undefined;
        if (bypass) {
            return execute(input, options, runId, idempotencyKey);
        }

        const running = inFlight.get(idempotencyKey);
        if (running !== undefined) {
            logger.info({ runId }, "identical request already in progress, joining it");
            return { ...(await running), idempotent_replay: true };
        }

        // No await between the lookup above and the set below, so two requests
        // in the same tick cannot both decide to start a run.
        const started = replayOrExecute(input, options, runId, idempotencyKey).finally(() => {
            inFlight.delete(idempotencyKey);
        });
        inFlight.set(idempotencyKey, started);
        return started;
    }

    return { run };
}
