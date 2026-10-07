/**
 * LlmGateway: one entry point for every model call in the pipeline.
 *
 * For each provider in the chain, in order:
 *   1. call it with a hard timeout
 *   2. on a transient failure, wait with exponential backoff plus jitter and try again
 *   3. when attempts run out, or the failure is permanent, fail over to the next provider
 *
 * Time, randomness and sleeping are injected. Tests pass fakes, so the retry
 * behaviour is checked in milliseconds and gives the same result on every run.
 */
import { err, ok, type Result } from "../core/result.js";
import { classifyError } from "./errors.js";
import type {
    AttemptOutcome,
    AttemptRecord,
    LlmClient,
    LlmFailure,
    LlmProvider,
    LlmSuccess,
} from "./types.js";

export interface GatewayOptions {
    /** Calls per provider before failing over. Minimum 1. */
    readonly maxAttemptsPerProvider: number;
    /** Ceiling of the first backoff wait. Doubles on every further attempt. */
    readonly baseDelayMs: number;
    /** Upper bound for any single wait. */
    readonly maxDelayMs: number;
    /** A call that takes longer than this is aborted and counted as a timeout. */
    readonly timeoutMs: number;
    readonly sleep: (ms: number) => Promise<void>;
    readonly random: () => number;
    readonly now: () => number;
    readonly onAttempt?: (attempt: AttemptRecord) => void;
}

export const DEFAULT_GATEWAY_OPTIONS: GatewayOptions = {
    maxAttemptsPerProvider: 3,
    baseDelayMs: 500,
    maxDelayMs: 8000,
    timeoutMs: 120_000,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
    now: Date.now,
};

/**
 * Full jitter backoff: a random wait between 0 and the capped exponential ceiling.
 * `attempt` is 1 based, so the ceilings are base, 2x base, 4x base and so on.
 * Randomness spreads out clients that were rate limited at the same moment.
 */
export function backoffDelay(
    attempt: number,
    baseDelayMs: number,
    maxDelayMs: number,
    random: () => number
): number {
    const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
    return Math.floor(random() * ceiling);
}

class TimeoutError extends Error {
    constructor(ms: number) {
        super(`LLM call exceeded ${ms}ms`);
        this.name = "TimeoutError";
    }
}

/**
 * Run one provider call with a deadline. The AbortSignal asks the SDK to
 * cancel the HTTP request. The race guarantees we stop waiting even when an
 * SDK ignores the signal.
 */
async function callWithTimeout(
    provider: LlmProvider,
    prompt: string,
    timeoutMs: number
): Promise<string> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new TimeoutError(timeoutMs));
        }, timeoutMs);
    });
    try {
        return await Promise.race([provider.generate(prompt, controller.signal), deadline]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

export class LlmGateway implements LlmClient {
    private readonly providers: readonly LlmProvider[];
    private readonly options: GatewayOptions;

    constructor(providers: readonly LlmProvider[], options: Partial<GatewayOptions> = {}) {
        this.providers = providers;
        this.options = { ...DEFAULT_GATEWAY_OPTIONS, ...options };
    }

    /** Provider names in failover order. */
    get chain(): readonly string[] {
        return this.providers.map((p) => p.name);
    }

    async generate(prompt: string): Promise<Result<LlmSuccess, LlmFailure>> {
        const attempts: AttemptRecord[] = [];
        if (this.providers.length === 0) {
            return err({
                code: "LLM_NO_PROVIDERS",
                message: "No LLM provider is configured",
                attempts,
            });
        }

        const maxAttempts = Math.max(1, this.options.maxAttemptsPerProvider);

        for (const provider of this.providers) {
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                const startedAt = this.options.now();
                const record = (
                    outcome: AttemptOutcome,
                    extra: { status?: number; message?: string } = {}
                ): AttemptRecord => {
                    const entry: AttemptRecord = {
                        provider: provider.name,
                        attempt,
                        durationMs: this.options.now() - startedAt,
                        outcome,
                        ...extra,
                    };
                    attempts.push(entry);
                    this.options.onAttempt?.(entry);
                    return entry;
                };

                let retryAfterMs: number | undefined;
                try {
                    const text = await callWithTimeout(provider, prompt, this.options.timeoutMs);
                    if (text.trim().length > 0) {
                        record("success");
                        return ok({ text, provider: provider.name, attempts });
                    }
                    // An empty completion is a soft failure. Treat it like a transient error.
                    record("empty", { message: "Provider returned an empty response" });
                } catch (cause) {
                    const info = classifyError(cause, this.options.now());
                    const isTimeout = cause instanceof TimeoutError;
                    const extra = {
                        message: info.message,
                        ...(info.status !== undefined ? { status: info.status } : {}),
                    };
                    if (!info.retryable) {
                        // Permanent for this provider (bad key, bad request). Go to the next one.
                        record("fatal_error", extra);
                        break;
                    }
                    record(isTimeout ? "timeout" : "retryable_error", extra);
                    retryAfterMs = info.retryAfterMs;
                }

                if (attempt < maxAttempts) {
                    const wait =
                        retryAfterMs !== undefined
                            ? Math.min(retryAfterMs, this.options.maxDelayMs)
                            : backoffDelay(
                                  attempt,
                                  this.options.baseDelayMs,
                                  this.options.maxDelayMs,
                                  this.options.random
                              );
                    await this.options.sleep(wait);
                }
            }
        }

        const last = attempts[attempts.length - 1];
        return err({
            code: "LLM_CHAIN_EXHAUSTED",
            message:
                `All providers failed (${this.chain.join(" -> ")}).` +
                (last?.message !== undefined ? ` Last error: ${last.message}` : ""),
            attempts,
        });
    }
}
