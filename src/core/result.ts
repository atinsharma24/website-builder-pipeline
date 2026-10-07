/**
 * Result type used across the pipeline.
 *
 * A stage never throws for an expected failure. It returns `{ ok: false, error }`
 * so the caller is forced by the type system to handle it before reading `value`.
 * SDK and network exceptions are caught at the edge and converted into this shape.
 */
export type Result<T, E = PipelineError> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
    return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
    return { ok: false, error };
}

/** The pipeline stage in which a failure happened. */
export type ErrorPhase = "validation" | "architect" | "builder" | "quality" | "upload";

export interface PipelineError {
    /** Stable machine readable code, for example `LLM_CHAIN_EXHAUSTED`. */
    readonly code: string;
    readonly phase: ErrorPhase;
    /** Human readable explanation, safe to return to the API caller. */
    readonly message: string;
    /** True when running the same request again could succeed. */
    readonly retryable: boolean;
}

export function pipelineError(
    phase: ErrorPhase,
    code: string,
    message: string,
    retryable = false
): PipelineError {
    return { code, phase, message, retryable };
}

/** Turn an unknown thrown value into a readable message without leaking objects. */
export function messageOf(cause: unknown): string {
    if (cause instanceof Error) return cause.message;
    if (typeof cause === "string") return cause;
    return "Unknown error";
}
