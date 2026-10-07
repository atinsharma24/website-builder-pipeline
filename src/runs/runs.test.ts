import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson, computeIdempotencyKey } from "./idempotency.js";
import { FileRunStore, InMemoryRunStore, type RunRecord, type RunStore } from "./run-store.js";

const scope = { useMock: false, skipUpload: false };

describe("canonicalJson", () => {
    it("sorts object keys at every depth", () => {
        expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    });

    it("keeps array order, because order in a list is meaningful", () => {
        expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    });

    it("drops undefined fields like JSON.stringify does", () => {
        expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    });
});

describe("computeIdempotencyKey", () => {
    it("is the same for the same content in a different key order", () => {
        const first = computeIdempotencyKey({ name: "A", city: "Indore" }, scope);
        const second = computeIdempotencyKey({ city: "Indore", name: "A" }, scope);
        expect(first).toBe(second);
        expect(first).toMatch(/^[0-9a-f]{64}$/);
    });

    it("changes when any field changes", () => {
        expect(computeIdempotencyKey({ name: "A" }, scope)).not.toBe(computeIdempotencyKey({ name: "B" }, scope));
    });

    it("separates mock runs, skipped uploads and caller supplied keys", () => {
        const base = computeIdempotencyKey({ name: "A" }, scope);
        expect(computeIdempotencyKey({ name: "A" }, { ...scope, useMock: true })).not.toBe(base);
        expect(computeIdempotencyKey({ name: "A" }, { ...scope, skipUpload: true })).not.toBe(base);
        expect(computeIdempotencyKey({ name: "A" }, { ...scope, clientKey: "abc" })).not.toBe(base);
    });
});

function record(runId: string, key: string, createdAt: string): RunRecord {
    return {
        runId,
        idempotencyKey: key,
        businessSlug: "sharma-optics",
        status: "succeeded",
        stage: "done",
        createdAt,
        updatedAt: createdAt,
        stageTimingsMs: { architect: 10 },
        llmAttempts: [],
        repairAttempts: 0,
    };
}

function storeContract(name: string, make: () => Promise<RunStore>) {
    describe(name, () => {
        it("returns undefined for an unknown run", async () => {
            expect(await (await make()).get("run-1")).toBeUndefined();
        });

        it("saves and reads back a record", async () => {
            const store = await make();
            await store.save(record("run-100-abc123", "k1", "2026-01-01T00:00:00.000Z"));
            const found = await store.get("run-100-abc123");
            expect(found?.idempotencyKey).toBe("k1");
            expect(found?.stageTimingsMs.architect).toBe(10);
        });

        it("overwrites a record with the same id", async () => {
            const store = await make();
            const first = record("run-100-abc123", "k1", "2026-01-01T00:00:00.000Z");
            await store.save(first);
            await store.save({ ...first, status: "failed" });
            expect((await store.get("run-100-abc123"))?.status).toBe("failed");
        });

        it("finds the newest record for a key", async () => {
            const store = await make();
            await store.save(record("run-100-aaaaaa", "k1", "2026-01-01T00:00:00.000Z"));
            await store.save(record("run-200-bbbbbb", "k1", "2026-01-02T00:00:00.000Z"));
            await store.save(record("run-300-cccccc", "other", "2026-01-03T00:00:00.000Z"));
            expect((await store.findLatestByKey("k1"))?.runId).toBe("run-200-bbbbbb");
            expect(await store.findLatestByKey("missing")).toBeUndefined();
        });
    });
}

storeContract("InMemoryRunStore", async () => new InMemoryRunStore());

describe("FileRunStore on disk", () => {
    let dir: string;
    beforeEach(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), "runs-"));
    });
    afterEach(async () => {
        await fs.rm(dir, { recursive: true, force: true });
    });

    storeContract("FileRunStore", async () => new FileRunStore(await fs.mkdtemp(path.join(os.tmpdir(), "runs-"))));

    it("leaves no temporary file behind after a save", async () => {
        const store = new FileRunStore(dir);
        await store.save(record("run-100-abc123", "k1", "2026-01-01T00:00:00.000Z"));
        expect(await fs.readdir(dir)).toEqual(["run-100-abc123.json"]);
    });

    it("refuses run ids that could escape the directory", async () => {
        const store = new FileRunStore(dir);
        await expect(store.save(record("../../etc/passwd", "k", "2026-01-01T00:00:00.000Z"))).rejects.toThrow(
            /unsafe id/
        );
        expect(await store.get("../../etc/passwd")).toBeUndefined();
    });

    it("works before the directory exists", async () => {
        const store = new FileRunStore(path.join(dir, "not-created-yet"));
        expect(await store.findLatestByKey("k")).toBeUndefined();
    });
});
