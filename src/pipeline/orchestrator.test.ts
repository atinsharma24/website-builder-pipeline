import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { silentLogger } from "../core/logger.js";
import type { LlmClient } from "../llm/types.js";
import { InMemoryRunStore } from "../runs/run-store.js";
import {
    recordingUploader,
    scriptedClient,
    VALID_HTML,
    VALID_INPUT,
    VALID_SPEC_JSON,
} from "../testing/fakes.js";
import { createPipeline, type PipelineDeps, type PipelineSettings } from "./orchestrator.js";

const BROKEN_HTML = VALID_HTML.slice(0, VALID_HTML.indexOf("<footer")); // cut off, like a token limit

function harness(parts: {
    architect?: LlmClient;
    builder?: LlmClient;
    settings?: Partial<PipelineSettings>;
    uploadOutcome?: Parameters<typeof recordingUploader>[0];
}) {
    let clock = 1_000_000;
    let counter = 0;
    const store = new InMemoryRunStore();
    const uploader = recordingUploader(parts.uploadOutcome);
    const architect = parts.architect ?? scriptedClient([VALID_SPEC_JSON]);
    const builder = parts.builder ?? scriptedClient([VALID_HTML]);
    const deps: PipelineDeps = {
        architectLlm: architect,
        builderLlm: builder,
        store,
        uploader,
        logger: silentLogger,
        now: () => (clock += 5),
        newRunId: () => `run-${++counter}`,
        settings: { maxRepairAttempts: 1, idempotencyTtlMs: 60_000, ...parts.settings },
    };
    return {
        pipeline: createPipeline(deps),
        store,
        uploader,
        advance: (ms: number) => {
            clock += ms;
        },
    };
}

describe("pipeline: happy path", () => {
    it("validates, generates, checks and uploads", async () => {
        const { pipeline, store, uploader } = harness({});
        const result = await pipeline.run(VALID_INPUT);

        expect(result.status).toBe("success");
        expect(result.business_slug).toBe("sharma-optics");
        expect(result.public_url).toBe("https://storage.example/sharma-optics/index.html");
        expect(result.repair_attempts).toBe(0);
        expect(uploader.uploads).toHaveLength(1);

        const record = await store.get(result.run_id);
        expect(record?.status).toBe("succeeded");
        expect(record?.stage).toBe("done");
        expect(Object.keys(record?.stageTimingsMs ?? {}).sort()).toEqual(["architect", "builder", "quality", "upload"]);
        expect(record?.llmAttempts).toHaveLength(2); // one architect call, one builder call
    });

    it("skips the upload when asked to", async () => {
        const { pipeline, uploader } = harness({});
        const result = await pipeline.run(VALID_INPUT, { skipUpload: true });
        expect(result.status).toBe("success");
        expect(result.public_url).toBeUndefined();
        expect(uploader.uploads).toHaveLength(0);
    });

    it("runs end to end in mock mode without calling any model", async () => {
        const architect = scriptedClient([new Error("must not be called")]);
        const builder = scriptedClient([new Error("must not be called")]);
        const { pipeline } = harness({ architect, builder });
        const result = await pipeline.run(VALID_INPUT, { useMock: true, skipUpload: true });

        expect(result.status).toBe("success");
        expect(architect.prompts).toHaveLength(0);
        expect(builder.prompts).toHaveLength(0);
    });
});

describe("pipeline: input validation", () => {
    it("rejects bad input before any model call", async () => {
        const architect = scriptedClient([VALID_SPEC_JSON]);
        const { pipeline } = harness({ architect });
        const result = await pipeline.run({ business_name: "X" });

        expect(result.status).toBe("error");
        expect(result.error_phase).toBe("validation");
        expect(result.error_code).toBe("INVALID_INPUT");
        expect(result.retryable).toBe(false);
        expect(architect.prompts).toHaveLength(0);
    });
});

describe("pipeline: quality gate", () => {
    it("asks the builder to repair broken HTML and publishes the fixed version", async () => {
        const builder = scriptedClient([BROKEN_HTML, VALID_HTML]);
        const { pipeline, uploader, store } = harness({ builder });
        const result = await pipeline.run(VALID_INPUT);

        expect(result.status).toBe("success");
        expect(result.repair_attempts).toBe(1);
        expect(builder.prompts).toHaveLength(2);
        expect(builder.prompts[1]).toContain("REJECTED BY AUTOMATED CHECKS");
        expect(builder.prompts[1]).toContain("cut off");
        expect(uploader.uploads).toHaveLength(1);
        expect((await store.get(result.run_id))?.repairAttempts).toBe(1);
    });

    it("refuses to publish HTML that still fails after the repair budget is spent", async () => {
        const builder = scriptedClient([BROKEN_HTML]);
        const { pipeline, uploader, store } = harness({ builder });
        const result = await pipeline.run(VALID_INPUT);

        expect(result.status).toBe("error");
        expect(result.error_phase).toBe("quality");
        expect(result.error_code).toBe("HTML_QUALITY_GATE_FAILED");
        expect(builder.prompts).toHaveLength(2); // first try plus one repair
        expect(uploader.uploads).toHaveLength(0);
        expect((await store.get(result.run_id))?.status).toBe("failed");
    });

    it("does not repair at all when the repair budget is zero", async () => {
        const builder = scriptedClient([BROKEN_HTML, VALID_HTML]);
        const { pipeline } = harness({ builder, settings: { maxRepairAttempts: 0 } });
        const result = await pipeline.run(VALID_INPUT);
        expect(result.error_phase).toBe("quality");
        expect(builder.prompts).toHaveLength(1);
    });

    it("returns gate warnings alongside a successful result", async () => {
        const noViewport = VALID_HTML.replace(/<meta name="viewport"[^>]*>/, "");
        const { pipeline } = harness({ builder: scriptedClient([noViewport]) });
        const result = await pipeline.run(VALID_INPUT);
        expect(result.status).toBe("success");
        expect(result.warnings?.join(" ")).toContain("viewport");
    });
});

describe("pipeline: failures in each stage", () => {
    it("reports an architect failure and never calls the builder", async () => {
        const builder = scriptedClient([VALID_HTML]);
        const { pipeline } = harness({ architect: scriptedClient([new Error("providers down")]), builder });
        const result = await pipeline.run(VALID_INPUT);

        expect(result.error_phase).toBe("architect");
        expect(result.error_code).toBe("LLM_CHAIN_EXHAUSTED");
        expect(result.retryable).toBe(true);
        expect(builder.prompts).toHaveLength(0);
    });

    it("reports a builder failure", async () => {
        const { pipeline } = harness({ builder: scriptedClient([new Error("providers down")]) });
        expect((await pipeline.run(VALID_INPUT)).error_phase).toBe("builder");
    });

    it("reports an upload failure", async () => {
        const { pipeline } = harness({ uploadOutcome: { success: false, error: "bucket missing" } });
        const result = await pipeline.run(VALID_INPUT);
        expect(result.error_phase).toBe("upload");
        expect(result.error_message).toContain("bucket missing");
    });

    it("turns an unexpected exception inside a stage into an error result", async () => {
        const exploding: LlmClient = {
            generate: async () => {
                throw new Error("boom");
            },
        };
        const { pipeline } = harness({ architect: exploding });
        const result = await pipeline.run(VALID_INPUT);
        expect(result.status).toBe("error");
        expect(result.error_code).toBe("UNEXPECTED_EXCEPTION");
        expect(result.error_message).toBe("boom");
    });
});

describe("pipeline: idempotency", () => {
    it("answers an identical request from the earlier run, with no new model calls or upload", async () => {
        const architect = scriptedClient([VALID_SPEC_JSON]);
        const builder = scriptedClient([VALID_HTML]);
        const { pipeline, uploader } = harness({ architect, builder });

        const first = await pipeline.run(VALID_INPUT);
        // same content, different key order
        const reordered = Object.fromEntries(Object.entries(VALID_INPUT).reverse());
        const second = await pipeline.run(reordered);

        expect(second.idempotent_replay).toBe(true);
        expect(second.run_id).toBe(first.run_id);
        expect(second.public_url).toBe(first.public_url);
        expect(architect.prompts).toHaveLength(1);
        expect(builder.prompts).toHaveLength(1);
        expect(uploader.uploads).toHaveLength(1);
    });

    it("lets two identical requests that arrive together share one run", async () => {
        const architect = scriptedClient([VALID_SPEC_JSON]);
        const { pipeline, uploader } = harness({ architect });

        const [a, b] = await Promise.all([pipeline.run(VALID_INPUT), pipeline.run(VALID_INPUT)]);

        expect(a.run_id).toBe(b.run_id);
        expect([a.idempotent_replay, b.idempotent_replay].filter(Boolean)).toHaveLength(1);
        expect(architect.prompts).toHaveLength(1);
        expect(uploader.uploads).toHaveLength(1);
    });

    it("generates again for different input", async () => {
        const architect = scriptedClient([VALID_SPEC_JSON]);
        const { pipeline } = harness({ architect });
        await pipeline.run(VALID_INPUT);
        const other = await pipeline.run({ ...VALID_INPUT, city: "Bhopal" });
        expect(other.idempotent_replay).toBeUndefined();
        expect(architect.prompts).toHaveLength(2);
    });

    it("generates again when force is set", async () => {
        const architect = scriptedClient([VALID_SPEC_JSON]);
        const { pipeline } = harness({ architect });
        await pipeline.run(VALID_INPUT);
        const forced = await pipeline.run(VALID_INPUT, { force: true });
        expect(forced.idempotent_replay).toBeUndefined();
        expect(architect.prompts).toHaveLength(2);
    });

    it("generates again once the earlier result is older than the TTL", async () => {
        const architect = scriptedClient([VALID_SPEC_JSON]);
        const { pipeline, advance } = harness({ architect });
        await pipeline.run(VALID_INPUT);
        advance(120_000);
        const later = await pipeline.run(VALID_INPUT);
        expect(later.idempotent_replay).toBeUndefined();
        expect(architect.prompts).toHaveLength(2);
    });

    it("does not replay a failed run", async () => {
        const builder = scriptedClient([new Error("down"), VALID_HTML]);
        const { pipeline } = harness({ builder });
        expect((await pipeline.run(VALID_INPUT)).status).toBe("error");
        const second = await pipeline.run(VALID_INPUT);
        expect(second.status).toBe("success");
        expect(second.idempotent_replay).toBeUndefined();
    });

    it("keeps mock results apart from real ones", async () => {
        const architect = scriptedClient([VALID_SPEC_JSON]);
        const { pipeline } = harness({ architect });
        await pipeline.run(VALID_INPUT, { useMock: true, skipUpload: true });
        const real = await pipeline.run(VALID_INPUT, { skipUpload: true });
        expect(real.idempotent_replay).toBeUndefined();
        expect(architect.prompts).toHaveLength(1);
    });

    it("never replays when the TTL is zero", async () => {
        const architect = scriptedClient([VALID_SPEC_JSON]);
        const { pipeline } = harness({ architect, settings: { idempotencyTtlMs: 0 } });
        await pipeline.run(VALID_INPUT);
        await pipeline.run(VALID_INPUT);
        expect(architect.prompts).toHaveLength(2);
    });
});

describe("pipeline: recovery from a saved spec", () => {
    async function tempDir(): Promise<string> {
        return fs.mkdtemp(path.join(os.tmpdir(), "pipeline-"));
    }

    it("saves the spec locally and rebuilds from it without calling the architect", async () => {
        const outputDir = await tempDir();
        const architect = scriptedClient([VALID_SPEC_JSON]);
        const builder = scriptedClient([new Error("builder down"), VALID_HTML]);
        const { pipeline } = harness({ architect, builder });

        const failed = await pipeline.run(VALID_INPUT, { outputDir });
        expect(failed.error_phase).toBe("builder");

        const retried = await pipeline.run(VALID_INPUT, {
            outputDir,
            retryRunId: failed.run_id,
            retrySlug: failed.business_slug!,
        });
        expect(retried.status).toBe("success");
        expect(architect.prompts).toHaveLength(1); // not called again
        const saved = await fs.readFile(path.join(outputDir, "sharma-optics", retried.run_id, "index.html"), "utf-8");
        expect(saved).toBe(VALID_HTML);
        await fs.rm(outputDir, { recursive: true, force: true });
    });

    it("rejects a retry reference that tries to leave the output directory", async () => {
        const outputDir = await tempDir();
        const builder = scriptedClient([VALID_HTML]);
        const { pipeline } = harness({ builder });
        const result = await pipeline.run(VALID_INPUT, { outputDir, retryRunId: "run-1", retrySlug: "../../etc" });

        expect(result.status).toBe("error");
        expect(result.error_code).toBe("RECOVERY_BAD_REFERENCE");
        expect(builder.prompts).toHaveLength(0);
        await fs.rm(outputDir, { recursive: true, force: true });
    });

    it("reports a missing saved spec", async () => {
        const outputDir = await tempDir();
        const { pipeline } = harness({});
        const result = await pipeline.run(VALID_INPUT, { outputDir, retryRunId: "run-999", retrySlug: "sharma-optics" });
        expect(result.error_code).toBe("RECOVERY_SPEC_NOT_FOUND");
        await fs.rm(outputDir, { recursive: true, force: true });
    });
});
