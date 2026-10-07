/**
 * Default wiring: builds the production pipeline from environment config.
 *
 * Everything that touches the outside world is constructed here and nowhere
 * else. The orchestrator itself only sees interfaces.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type AppConfig } from "../config/env.js";
import { jsonLogger, type Logger } from "../core/logger.js";
import { LlmGateway } from "../llm/gateway.js";
import { createProvider, type ProviderEnv } from "../llm/providers.js";
import type { ProviderName } from "../llm/types.js";
import { FileRunStore, type RunStore } from "../runs/run-store.js";
import type { PipelineResult } from "../schemas/pipeline-result.js";
import { generateRunId } from "../services/slugify.js";
import {
    createPipeline,
    type Pipeline,
    type PipelineOptions,
    type Uploader,
} from "./orchestrator.js";

export { createPipeline } from "./orchestrator.js";
export type {
    Pipeline,
    PipelineDeps,
    PipelineOptions,
    PipelineSettings,
    Uploader,
    UploadOutcome,
} from "./orchestrator.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Where run records are written by default: `<project>/.runs`. */
export const DEFAULT_RUNS_DIR = path.join(moduleDir, "../../.runs");

function buildGateway(
    chain: readonly ProviderName[],
    config: AppConfig,
    env: ProviderEnv,
    logger: Logger
): LlmGateway {
    return new LlmGateway(
        chain.map((name) => createProvider(name, env)),
        {
            ...config.llm,
            onAttempt: (attempt) => {
                const log = attempt.outcome === "success" ? logger.info : logger.warn;
                log.call(logger, { ...attempt }, "llm attempt");
            },
        }
    );
}

export interface ProductionOverrides {
    readonly config?: AppConfig;
    readonly store?: RunStore;
    readonly uploader?: Uploader;
    readonly logger?: Logger;
    readonly env?: ProviderEnv;
}

/** Build the real pipeline. Tests pass overrides. The server passes none. */
export async function buildProductionPipeline(overrides: ProductionOverrides = {}): Promise<Pipeline> {
    const config = overrides.config ?? loadConfig();
    const logger = overrides.logger ?? jsonLogger;
    const env = overrides.env ?? (process.env as ProviderEnv);
    // Imported lazily so that importing this module never needs Supabase credentials.
    const uploader = overrides.uploader ?? (await import("../services/supabase.js"));

    return createPipeline({
        architectLlm: buildGateway(config.architectChain, config, env, logger),
        builderLlm: buildGateway(config.builderChain, config, env, logger),
        store: overrides.store ?? new FileRunStore(DEFAULT_RUNS_DIR),
        uploader,
        logger,
        now: Date.now,
        newRunId: generateRunId,
        settings: {
            maxRepairAttempts: config.maxRepairAttempts,
            idempotencyTtlMs: config.idempotencyTtlMs,
            ...(config.allowedScriptHosts !== undefined
                ? { htmlOptions: { allowedScriptHosts: config.allowedScriptHosts } }
                : {}),
        },
    });
}

let defaultPipeline: Promise<Pipeline> | undefined;

/**
 * Run the pipeline with production wiring.
 * Kept for callers that used the old single function API.
 */
export async function runPipeline(
    rawInput: unknown,
    options: PipelineOptions = {}
): Promise<PipelineResult> {
    defaultPipeline ??= buildProductionPipeline();
    return (await defaultPipeline).run(rawInput, options);
}
