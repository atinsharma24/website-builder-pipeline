import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { silentLogger } from "./core/logger.js";
import { createPipeline } from "./pipeline/orchestrator.js";
import { InMemoryRunStore } from "./runs/run-store.js";
import type { PipelineResult } from "./schemas/pipeline-result.js";
import { buildServer, httpStatusFor, secretsMatch } from "./server.js";
import {
    recordingUploader,
    scriptedClient,
    VALID_HTML,
    VALID_INPUT,
    VALID_SPEC_JSON,
    type RecordingUploader,
} from "./testing/fakes.js";

let workDir: string;
let app: FastifyInstance;
let uploader: RecordingUploader;

async function makeApp(options: { apiKey?: string; builderReplies?: Array<string | Error> } = {}) {
    const store = new InMemoryRunStore();
    uploader = recordingUploader();
    const architectLlm = scriptedClient([VALID_SPEC_JSON]);
    let counter = 0;
    const pipeline = createPipeline({
        architectLlm,
        builderLlm: scriptedClient(options.builderReplies ?? [VALID_HTML]),
        store,
        uploader,
        logger: silentLogger,
        now: Date.now,
        newRunId: () => `run-${1000 + ++counter}`,
        settings: { maxRepairAttempts: 0, idempotencyTtlMs: 60_000 },
    });
    return buildServer({
        pipeline,
        architectLlm,
        store,
        uploader,
        outputDir: path.join(workDir, "output"),
        tasksDir: path.join(workDir, "tasks"),
        apiKey: options.apiKey,
        maxRepairAttempts: 0,
        logger: false,
    });
}

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "server-"));
});
afterEach(async () => {
    await app?.close();
    await fs.rm(workDir, { recursive: true, force: true });
});

describe("helpers", () => {
    it("maps result phases to HTTP statuses", () => {
        const base: PipelineResult = { status: "error", run_id: "run-1" };
        expect(httpStatusFor({ status: "success", run_id: "run-1" })).toBe(200);
        expect(httpStatusFor({ ...base, error_phase: "validation" })).toBe(400);
        expect(httpStatusFor({ ...base, error_phase: "quality" })).toBe(422);
        expect(httpStatusFor({ ...base, error_phase: "builder" })).toBe(502);
        expect(httpStatusFor({ ...base, error_phase: "upload" })).toBe(502);
    });

    it("compares secrets of any length", () => {
        expect(secretsMatch("s3cret", "s3cret")).toBe(true);
        expect(secretsMatch("s3cret", "s3cre")).toBe(false);
        expect(secretsMatch("", "s3cret")).toBe(false);
    });
});

describe("authentication", () => {
    it("is off when no key is configured", async () => {
        app = await makeApp();
        const res = await app.inject({ method: "POST", url: "/validate", payload: VALID_INPUT });
        expect(res.statusCode).toBe(200);
    });

    it("rejects requests without the key and accepts requests with it", async () => {
        app = await makeApp({ apiKey: "s3cret" });
        const missing = await app.inject({ method: "POST", url: "/validate", payload: VALID_INPUT });
        const wrong = await app.inject({
            method: "POST",
            url: "/validate",
            payload: VALID_INPUT,
            headers: { "x-api-key": "nope" },
        });
        const right = await app.inject({
            method: "POST",
            url: "/validate",
            payload: VALID_INPUT,
            headers: { "x-api-key": "s3cret" },
        });
        expect(missing.statusCode).toBe(401);
        expect(wrong.statusCode).toBe(401);
        expect(right.statusCode).toBe(200);
    });

    it("keeps /health open for uptime checks", async () => {
        app = await makeApp({ apiKey: "s3cret" });
        const res = await app.inject({ method: "GET", url: "/health" });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ status: "healthy", auth_required: true });
    });
});

describe("POST /pipeline", () => {
    it("runs the pipeline and returns 200 with the result", async () => {
        app = await makeApp();
        const res = await app.inject({ method: "POST", url: "/pipeline", payload: VALID_INPUT });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ status: "success", business_slug: "sharma-optics" });
        expect(uploader.uploads).toHaveLength(1);
    });

    it("works in mock mode with the upload skipped", async () => {
        app = await makeApp({ builderReplies: [new Error("must not be called")] });
        const res = await app.inject({
            method: "POST",
            url: "/pipeline?mock=true&skipUpload=true",
            payload: VALID_INPUT,
        });
        expect(res.statusCode).toBe(200);
        expect(uploader.uploads).toHaveLength(0);
    });

    it("returns 400 for invalid input", async () => {
        app = await makeApp();
        const res = await app.inject({ method: "POST", url: "/pipeline", payload: { business_name: "X" } });
        expect(res.statusCode).toBe(400);
        expect(res.json().error_phase).toBe("validation");
    });

    it("returns 422 when the HTML fails the quality gate", async () => {
        app = await makeApp({ builderReplies: ["<p>not a document</p>"] });
        const res = await app.inject({ method: "POST", url: "/pipeline", payload: VALID_INPUT });
        expect(res.statusCode).toBe(422);
        expect(uploader.uploads).toHaveLength(0);
    });

    it("returns 502 when the model providers fail", async () => {
        app = await makeApp({ builderReplies: [new Error("down")] });
        const res = await app.inject({ method: "POST", url: "/pipeline", payload: VALID_INPUT });
        expect(res.statusCode).toBe(502);
        expect(res.json().error_phase).toBe("builder");
    });

    it("replays an identical request and treats a different Idempotency-Key as a new one", async () => {
        app = await makeApp();
        const first = await app.inject({ method: "POST", url: "/pipeline", payload: VALID_INPUT });
        const again = await app.inject({ method: "POST", url: "/pipeline", payload: VALID_INPUT });
        const keyed = await app.inject({
            method: "POST",
            url: "/pipeline",
            payload: VALID_INPUT,
            headers: { "idempotency-key": "order-42" },
        });
        expect(again.json().idempotent_replay).toBe(true);
        expect(again.json().run_id).toBe(first.json().run_id);
        expect(keyed.json().idempotent_replay).toBeUndefined();
        expect(uploader.uploads).toHaveLength(2);
    });
});

describe("GET /runs/:runId", () => {
    it("returns the run record with stage timings", async () => {
        app = await makeApp();
        const created = await app.inject({ method: "POST", url: "/pipeline", payload: VALID_INPUT });
        const res = await app.inject({ method: "GET", url: `/runs/${created.json().run_id}` });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ status: "succeeded", stage: "done", businessSlug: "sharma-optics" });
        expect(res.json().stageTimingsMs).toHaveProperty("builder");
    });

    it("returns 404 for an unknown run and 400 for a malformed id", async () => {
        app = await makeApp();
        expect((await app.inject({ method: "GET", url: "/runs/run-999999" })).statusCode).toBe(404);
        expect((await app.inject({ method: "GET", url: "/runs/..%2Fsecrets" })).statusCode).toBe(400);
    });
});

describe("POST /upload", () => {
    async function placeHtml(slug: string, runId: string, html: string) {
        const dir = path.join(workDir, "output", slug, runId);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "index.html"), html);
    }

    it("publishes a hand built file that passes the gate", async () => {
        app = await makeApp();
        await placeHtml("sharma-optics", "run-5", VALID_HTML);
        const res = await app.inject({ method: "POST", url: "/upload?runId=run-5&slug=sharma-optics" });
        expect(res.statusCode).toBe(200);
        expect(uploader.uploads).toEqual([{ slug: "sharma-optics", runId: "run-5", bytes: Buffer.byteLength(VALID_HTML) }]);
    });

    it("refuses a hand built file that fails the gate", async () => {
        app = await makeApp();
        await placeHtml("sharma-optics", "run-6", "<p>half a page");
        const res = await app.inject({ method: "POST", url: "/upload?runId=run-6&slug=sharma-optics" });
        expect(res.statusCode).toBe(422);
        expect(uploader.uploads).toHaveLength(0);
    });

    it("blocks path traversal through slug and runId", async () => {
        app = await makeApp();
        // A file that exists outside the output directory and must stay unreachable.
        await fs.writeFile(path.join(workDir, "index.html"), VALID_HTML);
        for (const url of [
            "/upload?runId=run-5&slug=..",
            "/upload?runId=run-5&slug=..%2F..",
            "/upload?runId=..&slug=sharma-optics",
            "/upload?runId=run-5",
        ]) {
            const res = await app.inject({ method: "POST", url });
            expect(res.statusCode).toBe(400);
        }
        expect(uploader.uploads).toHaveLength(0);
    });

    it("returns 404 when the file does not exist", async () => {
        app = await makeApp();
        const res = await app.inject({ method: "POST", url: "/upload?runId=run-7&slug=sharma-optics" });
        expect(res.statusCode).toBe(404);
    });
});

describe("POST /pipeline/retry and /architect", () => {
    it("rejects malformed retry references", async () => {
        app = await makeApp();
        const res = await app.inject({
            method: "POST",
            url: "/pipeline/retry?retryRunId=run-1&retrySlug=..%2F..",
            payload: VALID_INPUT,
        });
        expect(res.statusCode).toBe(400);
    });

    it("writes a task file and a spec for the architect only workflow", async () => {
        app = await makeApp();
        const res = await app.inject({ method: "POST", url: "/architect?mock=true", payload: VALID_INPUT });
        expect(res.statusCode).toBe(200);
        const body = res.json() as { run_id: string; status: string };
        expect(body.status).toBe("pending_builder");
        const task = await fs.readFile(path.join(workDir, "tasks", `${body.run_id}.md`), "utf-8");
        expect(task).toContain("Sharma Optics");
        const spec = await fs.readFile(
            path.join(workDir, "output", "sharma-optics", body.run_id, "architect-spec.json"),
            "utf-8"
        );
        expect(JSON.parse(spec)).toHaveProperty("website_generation_prompt");
    });
});
