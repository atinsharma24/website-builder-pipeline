/**
 * Typed, validated configuration.
 *
 * Environment variables are strings that may be missing or mistyped. They are
 * parsed once at startup with Zod. A bad value stops the server with a clear
 * message instead of surfacing as a strange failure on the first request.
 *
 * API keys are deliberately optional here. Mock mode and the test suite need
 * none, and a missing key for one provider must not stop the others. A
 * provider with no key fails its own call, and the gateway moves on.
 */
import { z } from "zod";
import { parseProviderChain } from "../llm/providers.js";
import type { ProviderName } from "../llm/types.js";

const intFromEnv = (fallback: number, min: number, max: number) =>
    z
        .string()
        .optional()
        .transform((raw, ctx) => {
            if (raw === undefined || raw.trim() === "") return fallback;
            const value = Number(raw);
            if (!Number.isInteger(value) || value < min || value > max) {
                ctx.addIssue({
                    code: "custom",
                    message: `must be an integer between ${min} and ${max}`,
                });
                return z.NEVER;
            }
            return value;
        });

const optionalString = z
    .string()
    .optional()
    .transform((raw) => (raw === undefined || raw.trim() === "" ? undefined : raw.trim()));

const EnvSchema = z.object({
    PORT: intFromEnv(4000, 1, 65535),

    // Provider selection. *_CHAIN wins. The single *_PROVIDER names are kept
    // so existing .env files continue to work unchanged.
    ARCHITECT_LLM_CHAIN: optionalString,
    BUILDER_LLM_CHAIN: optionalString,
    ARCHITECT_LLM_PROVIDER: optionalString,
    BUILDER_LLM_PROVIDER: optionalString,

    // Gateway behaviour
    LLM_MAX_ATTEMPTS: intFromEnv(3, 1, 10),
    LLM_BASE_DELAY_MS: intFromEnv(500, 0, 60_000),
    LLM_MAX_DELAY_MS: intFromEnv(8000, 0, 300_000),
    LLM_TIMEOUT_MS: intFromEnv(120_000, 1000, 900_000),

    // Quality gate
    MAX_REPAIR_ATTEMPTS: intFromEnv(1, 0, 3),
    ALLOWED_SCRIPT_HOSTS: optionalString,

    // Idempotency
    IDEMPOTENCY_TTL_SECONDS: intFromEnv(86_400, 0, 2_592_000),

    // When set, every route except /health requires this value in x-api-key.
    PIPELINE_API_KEY: optionalString,
});

export interface AppConfig {
    readonly port: number;
    readonly architectChain: readonly ProviderName[];
    readonly builderChain: readonly ProviderName[];
    readonly llm: {
        readonly maxAttemptsPerProvider: number;
        readonly baseDelayMs: number;
        readonly maxDelayMs: number;
        readonly timeoutMs: number;
    };
    readonly maxRepairAttempts: number;
    /** Undefined means use the validator's built in allow list. */
    readonly allowedScriptHosts: readonly string[] | undefined;
    readonly idempotencyTtlMs: number;
    readonly apiKey: string | undefined;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

export function loadConfig(env: EnvSource = process.env): AppConfig {
    const parsed = EnvSchema.safeParse(env);
    if (!parsed.success) {
        const details = parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ");
        throw new Error(`Invalid environment configuration. ${details}`);
    }
    const values = parsed.data;

    const architectChain = parseProviderChain(
        values.ARCHITECT_LLM_CHAIN ?? values.ARCHITECT_LLM_PROVIDER ?? "gemini"
    );
    const builderChain = parseProviderChain(
        values.BUILDER_LLM_CHAIN ?? values.BUILDER_LLM_PROVIDER ?? "gemini"
    );

    const allowedScriptHosts = values.ALLOWED_SCRIPT_HOSTS?.split(",")
        .map((host) => host.trim().toLowerCase())
        .filter((host) => host !== "");

    return {
        port: values.PORT,
        architectChain,
        builderChain,
        llm: {
            maxAttemptsPerProvider: values.LLM_MAX_ATTEMPTS,
            baseDelayMs: values.LLM_BASE_DELAY_MS,
            maxDelayMs: values.LLM_MAX_DELAY_MS,
            timeoutMs: values.LLM_TIMEOUT_MS,
        },
        maxRepairAttempts: values.MAX_REPAIR_ATTEMPTS,
        allowedScriptHosts:
            allowedScriptHosts !== undefined && allowedScriptHosts.length > 0
                ? allowedScriptHosts
                : undefined,
        idempotencyTtlMs: values.IDEMPOTENCY_TTL_SECONDS * 1000,
        apiKey: values.PIPELINE_API_KEY,
    };
}
