/**
 * Idempotency keys.
 *
 * Two requests that describe the same business in the same mode must map to
 * the same key, so the second one can reuse the first one's result instead of
 * paying for two more LLM calls and publishing a duplicate site.
 */
import { createHash } from "node:crypto";

/**
 * Serialise a value with object keys in sorted order at every depth.
 * `JSON.stringify` keeps insertion order, so `{a,b}` and `{b,a}` would hash
 * differently without this step.
 */
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value) ?? "null";
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
        const item = record[key];
        if (item === undefined) continue; // same as JSON.stringify: undefined fields vanish
        parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
    }
    return `{${parts.join(",")}}`;
}

export interface IdempotencyScope {
    /** Mock runs and real runs must never share a result. */
    readonly useMock: boolean;
    readonly skipUpload: boolean;
    /** Optional caller supplied key from the Idempotency-Key header. */
    readonly clientKey?: string;
}

/**
 * SHA-256 over the canonical form of the validated input plus the run mode.
 * Hashing the validated input (not the raw body) means defaults are applied
 * first, so `photos: []` and a missing `photos` field give the same key.
 */
export function computeIdempotencyKey(validatedInput: unknown, scope: IdempotencyScope): string {
    const material = canonicalJson({
        input: validatedInput,
        mock: scope.useMock,
        skipUpload: scope.skipUpload,
        clientKey: scope.clientKey ?? null,
    });
    return createHash("sha256").update(material).digest("hex");
}
