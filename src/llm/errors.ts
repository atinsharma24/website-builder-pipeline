/**
 * Error classification for LLM calls.
 *
 * The gateway needs one question answered for every failure: is it worth
 * calling the same provider again? Rate limits, server errors, timeouts and
 * dropped connections are. A bad request or a bad key is not.
 */

const RETRYABLE_NETWORK_CODES = new Set([
    "ECONNRESET",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "EPIPE",
    "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_TIMEOUT",
]);

export interface ErrorClassification {
    readonly retryable: boolean;
    readonly status?: number;
    /** Wait requested by the server through a Retry-After header, if any. */
    readonly retryAfterMs?: number;
    readonly message: string;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function field(source: unknown, key: string): unknown {
    if (typeof source !== "object" || source === null) return undefined;
    return (source as Record<string, unknown>)[key];
}

/**
 * Parse a Retry-After header value. It is either a number of seconds or an
 * HTTP date. Returns milliseconds, or undefined when it cannot be read.
 */
export function parseRetryAfter(value: string | undefined, nowMs: number): number | undefined {
    if (value === undefined || value.trim() === "") return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
    const dateMs = Date.parse(value);
    if (Number.isNaN(dateMs)) return undefined;
    return Math.max(0, dateMs - nowMs);
}

function readRetryAfterHeader(error: unknown): string | undefined {
    const headers = field(error, "headers");
    if (headers === undefined || headers === null) return undefined;
    // Fetch style Headers object
    const getter = field(headers, "get");
    if (typeof getter === "function") {
        const value: unknown = (getter as (name: string) => unknown).call(headers, "retry-after");
        return readString(value);
    }
    // Plain object
    return readString(field(headers, "retry-after"));
}

export function classifyError(error: unknown, nowMs: number = Date.now()): ErrorClassification {
    const message = error instanceof Error ? error.message : readString(error) ?? "Unknown LLM error";
    const status = readNumber(field(error, "status")) ?? readNumber(field(error, "statusCode"));
    const code = readString(field(error, "code"));
    const name = readString(field(error, "name"));
    const retryAfterMs = parseRetryAfter(readRetryAfterHeader(error), nowMs);

    let retryable = false;
    if (status !== undefined) {
        // 408 request timeout, 409 conflict and 429 rate limit are transient. So is any 5xx.
        retryable = status === 408 || status === 409 || status === 429 || status >= 500;
    } else if (code !== undefined && RETRYABLE_NETWORK_CODES.has(code)) {
        retryable = true;
    } else if (name === "AbortError" || name === "TimeoutError") {
        retryable = true;
    }

    return {
        retryable,
        message,
        ...(status !== undefined ? { status } : {}),
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    };
}
