/**
 * Contracts for the LLM layer.
 *
 * Agents depend on `LlmClient` only. They never import a vendor SDK, so a
 * provider can be added, removed or reordered without touching agent code.
 */
import type { Result } from "../core/result.js";

export type ProviderName = "gemini" | "openai" | "claude";

export const PROVIDER_NAMES: readonly ProviderName[] = ["gemini", "openai", "claude"];

/** One vendor adapter. `generate` resolves with text or throws. */
export interface LlmProvider {
    readonly name: string;
    generate(prompt: string, signal: AbortSignal): Promise<string>;
}

export type AttemptOutcome = "success" | "retryable_error" | "fatal_error" | "timeout" | "empty";

/** One call to one provider, kept for logs and for the run record. */
export interface AttemptRecord {
    readonly provider: string;
    /** 1 based attempt number for this provider. */
    readonly attempt: number;
    readonly durationMs: number;
    readonly outcome: AttemptOutcome;
    readonly status?: number;
    readonly message?: string;
}

export interface LlmSuccess {
    readonly text: string;
    /** The provider that finally produced the text. */
    readonly provider: string;
    readonly attempts: readonly AttemptRecord[];
}

export interface LlmFailure {
    readonly code: "LLM_CHAIN_EXHAUSTED" | "LLM_NO_PROVIDERS";
    readonly message: string;
    readonly attempts: readonly AttemptRecord[];
}

/** What agents call. Implemented by `LlmGateway` and by fakes in tests. */
export interface LlmClient {
    generate(prompt: string): Promise<Result<LlmSuccess, LlmFailure>>;
}

/**
 * Whether sending the same request again could work. False only when every
 * attempt failed permanently, for example every provider rejected its key.
 */
export function isChainRetryable(failure: LlmFailure): boolean {
    if (failure.attempts.length === 0) return false;
    return failure.attempts.some((attempt) => attempt.outcome !== "fatal_error");
}
