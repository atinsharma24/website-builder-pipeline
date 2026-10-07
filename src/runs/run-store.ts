/**
 * Run records and where they are kept.
 *
 * Every pipeline run is written down as it moves through its stages. That
 * record answers three questions later: what happened to run X, how long did
 * each stage take, and has this exact request already been served.
 *
 * `RunStore` is an interface so the orchestrator does not care where records
 * live. Two implementations ship here: memory for tests, and one JSON file
 * per run for a single server. A Postgres table is the natural next step when
 * more than one server instance runs.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { AttemptRecord } from "../llm/types.js";
import type { PipelineResult } from "../schemas/pipeline-result.js";

export type RunStatus = "running" | "succeeded" | "failed";

export type RunStage =
    | "validation"
    | "architect"
    | "builder"
    | "quality"
    | "upload"
    | "done";

export interface RunRecord {
    readonly runId: string;
    readonly idempotencyKey: string;
    readonly businessSlug: string;
    status: RunStatus;
    stage: RunStage;
    readonly createdAt: string;
    updatedAt: string;
    /** Wall clock milliseconds spent in each finished stage. */
    stageTimingsMs: Partial<Record<RunStage, number>>;
    /** Every LLM call made for this run, across both agents. */
    llmAttempts: AttemptRecord[];
    /** How many times the Builder was asked to repair its own output. */
    repairAttempts: number;
    result?: PipelineResult;
}

export interface RunStore {
    get(runId: string): Promise<RunRecord | undefined>;
    /** The most recently created record for this key, if any. */
    findLatestByKey(idempotencyKey: string): Promise<RunRecord | undefined>;
    save(record: RunRecord): Promise<void>;
}

export class InMemoryRunStore implements RunStore {
    private readonly records = new Map<string, RunRecord>();

    async get(runId: string): Promise<RunRecord | undefined> {
        const found = this.records.get(runId);
        return found === undefined ? undefined : structuredClone(found);
    }

    async findLatestByKey(idempotencyKey: string): Promise<RunRecord | undefined> {
        let latest: RunRecord | undefined;
        for (const record of this.records.values()) {
            if (record.idempotencyKey !== idempotencyKey) continue;
            if (latest === undefined || record.createdAt >= latest.createdAt) latest = record;
        }
        return latest === undefined ? undefined : structuredClone(latest);
    }

    async save(record: RunRecord): Promise<void> {
        this.records.set(record.runId, structuredClone(record));
    }
}

const RUN_FILE_PATTERN = /^run-[0-9]{1,16}(?:-[a-z0-9]{1,16})?\.json$/;

/**
 * One JSON file per run under `dir`.
 *
 * Writes go to a temporary file first and are then renamed into place.
 * A rename inside one directory is atomic on POSIX file systems, so a reader
 * never sees a half written record, even if the process dies mid write.
 */
export class FileRunStore implements RunStore {
    constructor(private readonly dir: string) {}

    private fileFor(runId: string): string | undefined {
        const name = `${runId}.json`;
        return RUN_FILE_PATTERN.test(name) ? path.join(this.dir, name) : undefined;
    }

    async get(runId: string): Promise<RunRecord | undefined> {
        const file = this.fileFor(runId);
        if (file === undefined) return undefined;
        try {
            return JSON.parse(await fs.readFile(file, "utf-8")) as RunRecord;
        } catch {
            return undefined;
        }
    }

    async findLatestByKey(idempotencyKey: string): Promise<RunRecord | undefined> {
        let names: string[];
        try {
            names = await fs.readdir(this.dir);
        } catch {
            return undefined; // directory does not exist yet, so there are no runs
        }
        let latest: RunRecord | undefined;
        for (const name of names) {
            if (!RUN_FILE_PATTERN.test(name)) continue;
            const record = await this.get(name.slice(0, -".json".length));
            if (record === undefined || record.idempotencyKey !== idempotencyKey) continue;
            if (latest === undefined || record.createdAt >= latest.createdAt) latest = record;
        }
        return latest;
    }

    async save(record: RunRecord): Promise<void> {
        const file = this.fileFor(record.runId);
        if (file === undefined) throw new Error(`Refusing to store run with unsafe id: ${record.runId}`);
        await fs.mkdir(this.dir, { recursive: true });
        const temp = `${file}.${process.pid}.tmp`;
        await fs.writeFile(temp, JSON.stringify(record, null, 2), "utf-8");
        await fs.rename(temp, file);
    }
}
