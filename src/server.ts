/**
 * HTTP layer. Builds the Fastify app from injected dependencies and does not
 * listen. `bridge-server.ts` calls this and starts listening. Tests call this
 * and use `app.inject`, so routes are tested without opening a port.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { mockArchitect, runArchitect } from "./agents/architect.js";
import type { LlmClient } from "./llm/types.js";
import type { Pipeline, Uploader } from "./pipeline/orchestrator.js";
import { describeErrors, validateHtml, type HtmlValidationOptions } from "./quality/html-validator.js";
import type { RunStore } from "./runs/run-store.js";
import { BusinessInputSchema } from "./schemas/business-input.js";
import type { PipelineResult } from "./schemas/pipeline-result.js";
import { isSafeRunId, isSafeSlug, resolveInside } from "./security/path-safety.js";
import { generateRunId, slugify } from "./services/slugify.js";

export interface ServerDeps {
    readonly pipeline: Pipeline;
    /** Used by the architect only workflow. */
    readonly architectLlm: LlmClient;
    readonly store: RunStore;
    readonly uploader: Uploader;
    readonly outputDir: string;
    readonly tasksDir: string;
    /** When set, every route except /health requires it in the x-api-key header. */
    readonly apiKey?: string | undefined;
    readonly maxRepairAttempts: number;
    readonly htmlOptions?: Partial<HtmlValidationOptions> | undefined;
    /** Extra fields for /health, such as the configured provider chains. */
    readonly healthInfo?: Record<string, unknown> | undefined;
    readonly logger?: boolean | undefined;
}

/**
 * Compare two secrets without leaking, through timing, how many leading
 * characters matched. Both sides are hashed first so the buffers always have
 * the same length, which `timingSafeEqual` requires.
 */
export function secretsMatch(provided: string, expected: string): boolean {
    const a = createHash("sha256").update(provided).digest();
    const b = createHash("sha256").update(expected).digest();
    return timingSafeEqual(a, b);
}

/** Map a pipeline result to an HTTP status the caller can act on. */
export function httpStatusFor(result: PipelineResult): number {
    if (result.status !== "error") return 200;
    switch (result.error_phase) {
        case "validation":
            return 400; // the caller sent bad input
        case "quality":
            return 422; // we produced something we refuse to publish
        default:
            return 502; // a model provider or storage failed
    }
}

function headerValue(value: string | string[] | undefined): string | undefined {
    const first = Array.isArray(value) ? value[0] : value;
    return first !== undefined && first.trim() !== "" ? first.trim() : undefined;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
    const app = Fastify({ logger: deps.logger ?? true });
    await app.register(cors);

    // ---- Authentication ------------------------------------------------
    app.addHook("onRequest", async (request, reply) => {
        if (deps.apiKey === undefined) return;
        if (request.method === "OPTIONS") return; // CORS preflight carries no credentials
        if (request.url.split("?")[0] === "/health") return;
        const provided = headerValue(request.headers["x-api-key"]);
        if (provided === undefined || !secretsMatch(provided, deps.apiKey)) {
            return reply.code(401).send({ status: "error", error_message: "Missing or invalid x-api-key" });
        }
    });

    // ============================================
    // POST /pipeline - Main Pipeline Endpoint
    // ============================================
    app.post("/pipeline", async (request, reply) => {
        const query = request.query as Record<string, string | undefined>;
        const clientKey = headerValue(request.headers["idempotency-key"]);
        const result = await deps.pipeline.run(request.body, {
            useMock: query.mock === "true",
            skipUpload: query.skipUpload === "true",
            force: query.force === "true",
            outputDir: deps.outputDir, // Save locally as backup and for recovery
            ...(clientKey !== undefined ? { clientKey } : {}),
        });
        return reply.code(httpStatusFor(result)).send(result);
    });

    // ============================================
    // POST /pipeline/retry - Builder-Only Retry
    // ============================================
    // Skips the architect stage by loading a persisted architect-spec.json
    // from a previous run, then re-runs builder + upload only.
    app.post("/pipeline/retry", async (request, reply) => {
        const query = request.query as Record<string, string | undefined>;
        const { retryRunId, retrySlug } = query;

        if (!isSafeRunId(retryRunId) || !isSafeSlug(retrySlug)) {
            return reply.code(400).send({
                status: "error",
                error_message:
                    "Missing or invalid query params: retryRunId and retrySlug. " +
                    "These are returned in the error response of a failed /pipeline run.",
            });
        }

        const result = await deps.pipeline.run(request.body, {
            skipUpload: query.skipUpload === "true",
            outputDir: deps.outputDir,
            retryRunId,
            retrySlug,
        });
        return reply.code(httpStatusFor(result)).send(result);
    });

    // ============================================
    // GET /runs/:runId - Inspect a run
    // ============================================
    app.get("/runs/:runId", async (request, reply) => {
        const { runId } = request.params as { runId: string };
        if (!isSafeRunId(runId)) {
            return reply.code(400).send({ status: "error", error_message: "Invalid run id" });
        }
        const record = await deps.store.get(runId);
        if (record === undefined) {
            return reply.code(404).send({ status: "error", error_message: `Run ${runId} not found` });
        }
        return record;
    });

    // ============================================
    // POST /validate - Validate Input Only
    // ============================================
    app.post("/validate", async (request, reply) => {
        const validation = BusinessInputSchema.safeParse(request.body);

        if (!validation.success) {
            return reply.code(400).send({
                valid: false,
                errors: validation.error.issues.map((e) => ({
                    field: e.path.join("."),
                    message: e.message,
                })),
            });
        }

        return { valid: true, data: validation.data };
    });

    // ============================================
    // POST /architect - Antigravity Workflow (Step 1)
    // ============================================
    // Runs only the Architect Agent and saves a task file for Antigravity to pick up
    app.post("/architect", async (request, reply) => {
        const useMock = (request.query as Record<string, string | undefined>).mock === "true";

        const validation = BusinessInputSchema.safeParse(request.body);
        if (!validation.success) {
            return reply.code(400).send({
                status: "error",
                errors: validation.error.issues.map((e) => ({
                    field: e.path.join("."),
                    message: e.message,
                })),
            });
        }

        const input = validation.data;
        const runId = generateRunId();
        const businessSlug = slugify(input.business_name);

        let architectOutput;
        if (useMock) {
            architectOutput = mockArchitect(input);
        } else {
            const produced = await runArchitect(input, deps.architectLlm, {
                maxRepairAttempts: deps.maxRepairAttempts,
            });
            if (!produced.ok) {
                return reply.code(502).send({
                    status: "error",
                    error_code: produced.error.code,
                    error_message: `Architect failed: ${produced.error.message}`,
                });
            }
            architectOutput = produced.value.value;
        }

        const taskOutputDir = resolveInside(deps.outputDir, businessSlug, runId);
        if (taskOutputDir === undefined) {
            return reply.code(500).send({ status: "error", error_message: "Could not resolve the output path" });
        }
        await fs.mkdir(taskOutputDir, { recursive: true });
        await fs.mkdir(deps.tasksDir, { recursive: true });

        // Save the task file as markdown for Antigravity to read
        const taskContent = `# Website Generation Task

## Run ID: ${runId}
## Business: ${input.business_name}
## Slug: ${businessSlug}

---

## OUTPUT LOCATION
Save your generated \`index.html\` to:
\`\`\`
output/${businessSlug}/${runId}/index.html
\`\`\`

---

## ARCHITECT PROMPT (Use this to generate the website)

${architectOutput.website_generation_prompt}

---

## STYLE GUIDELINES
${architectOutput.site_style_guidelines ? JSON.stringify(architectOutput.site_style_guidelines, null, 2) : "Use your best judgment for colors and fonts."}

---

## REQUIRED SECTIONS
${architectOutput.page_sections ? architectOutput.page_sections.map((s) => `- **${s.section_name}** (${s.section_id}): ${s.copy_hints ?? ""}`).join("\n") : "Standard business sections"}

---

## AFTER GENERATING

1. Save the HTML file to the output location above
2. Call: \`curl -X POST "http://localhost:4000/upload?runId=${runId}&slug=${businessSlug}"\`
   OR just wait - the watcher will auto-upload when it detects the file.
`;

        await fs.writeFile(path.join(deps.tasksDir, `${runId}.md`), taskContent, "utf-8");
        await fs.writeFile(
            path.join(taskOutputDir, "architect-spec.json"),
            JSON.stringify(architectOutput, null, 2),
            "utf-8"
        );

        return {
            status: "pending_builder",
            run_id: runId,
            business_slug: businessSlug,
            task_file: `tasks/${runId}.md`,
            output_path: `output/${businessSlug}/${runId}/index.html`,
            spec_file: `output/${businessSlug}/${runId}/architect-spec.json`,
            next_step: "Generate index.html using the architect prompt, then call POST /upload or let watcher auto-upload",
        };
    });

    // ============================================
    // POST /upload - Upload existing HTML (Step 2)
    // ============================================
    // Publishes an HTML file that was built outside the automated pipeline.
    // It goes through the same quality gate as generated HTML.
    app.post("/upload", async (request, reply) => {
        const query = request.query as Record<string, string | undefined>;
        const { runId, slug } = query;

        // Both values become path segments, so they are checked before any file access.
        if (!isSafeRunId(runId) || !isSafeSlug(slug)) {
            return reply.code(400).send({
                status: "error",
                error_message: "Missing or invalid query params: runId and slug",
            });
        }

        const htmlPath = resolveInside(deps.outputDir, slug, runId, "index.html");
        if (htmlPath === undefined) {
            return reply.code(400).send({ status: "error", error_message: "Invalid path" });
        }

        let htmlContent: string;
        try {
            htmlContent = await fs.readFile(htmlPath, "utf-8");
        } catch {
            return reply.code(404).send({
                status: "error",
                error_message: "HTML file not found",
                expected_path: `output/${slug}/${runId}/index.html`,
            });
        }

        const report = validateHtml(htmlContent, deps.htmlOptions);
        if (!report.ok) {
            return reply.code(422).send({
                status: "error",
                error_phase: "quality",
                error_code: "HTML_QUALITY_GATE_FAILED",
                error_message: `HTML failed the quality gate: ${describeErrors(report)}`,
            });
        }

        const result = await deps.uploader.uploadWebsite(slug, htmlContent, runId);
        if (!result.success) {
            return reply.code(502).send({ status: "error", error_message: result.error ?? "Upload failed" });
        }

        return {
            status: "success",
            run_id: runId,
            business_slug: slug,
            public_url: result.publicUrl,
            storage_path: result.storagePath,
            html_size_bytes: result.sizeBytes,
        };
    });

    // ============================================
    // GET /health - Health Check
    // ============================================
    app.get("/health", async () => {
        return {
            status: "healthy",
            timestamp: new Date().toISOString(),
            auth_required: deps.apiKey !== undefined,
            ...deps.healthInfo,
        };
    });

    return app;
}
