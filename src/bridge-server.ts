/**
 * Process entry point. Reads configuration, wires the production
 * dependencies together, and starts listening.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loadConfig } from "./config/env.js";
import { LlmGateway } from "./llm/gateway.js";
import { createProvider, type ProviderEnv } from "./llm/providers.js";
import { buildProductionPipeline, DEFAULT_RUNS_DIR } from "./pipeline/index.js";
import { FileRunStore } from "./runs/run-store.js";
import { buildServer } from "./server.js";

dotenv.config();

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(moduleDir, "../output");
const tasksDir = path.join(moduleDir, "../tasks");

async function start(): Promise<void> {
    // Fails fast with a readable message when an environment value is invalid.
    const config = loadConfig();
    const env = process.env as ProviderEnv;
    const store = new FileRunStore(DEFAULT_RUNS_DIR);
    const uploader = await import("./services/supabase.js");
    const pipeline = await buildProductionPipeline({ config, store, uploader, env });

    const app = await buildServer({
        pipeline,
        architectLlm: new LlmGateway(
            config.architectChain.map((name) => createProvider(name, env)),
            config.llm
        ),
        store,
        uploader,
        outputDir,
        tasksDir,
        apiKey: config.apiKey,
        maxRepairAttempts: config.maxRepairAttempts,
        htmlOptions:
            config.allowedScriptHosts !== undefined
                ? { allowedScriptHosts: config.allowedScriptHosts }
                : undefined,
        healthInfo: {
            architect_chain: config.architectChain,
            builder_chain: config.builderChain,
            supabase_configured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
        },
    });

    await app.listen({ port: config.port, host: "0.0.0.0" });
    app.log.info(
        {
            port: config.port,
            architectChain: config.architectChain,
            builderChain: config.builderChain,
            authRequired: config.apiKey !== undefined,
        },
        "website pipeline api started"
    );
}

start().catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exit(1);
});
