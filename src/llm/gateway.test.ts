import { describe, expect, it } from "vitest";
import { httpError, scriptedProvider } from "../testing/fakes.js";
import { classifyError, parseRetryAfter } from "./errors.js";
import { backoffDelay, LlmGateway } from "./gateway.js";
import { isChainRetryable } from "./types.js";

/** Options that make the gateway instant and deterministic. */
function testOptions(sleeps: number[]) {
    return {
        maxAttemptsPerProvider: 3,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        timeoutMs: 50,
        sleep: async (ms: number) => {
            sleeps.push(ms);
        },
        random: () => 0.5,
        now: () => 0,
    };
}

describe("backoffDelay", () => {
    it("doubles the ceiling on each attempt and applies jitter", () => {
        const top = () => 0.999999;
        expect(backoffDelay(1, 100, 1000, top)).toBe(99);
        expect(backoffDelay(2, 100, 1000, top)).toBe(199);
        expect(backoffDelay(3, 100, 1000, top)).toBe(399);
        expect(backoffDelay(1, 100, 1000, () => 0)).toBe(0);
    });

    it("never exceeds the maximum delay", () => {
        expect(backoffDelay(20, 100, 1000, () => 0.999999)).toBe(999);
    });
});

describe("classifyError", () => {
    it("treats rate limits and server errors as retryable", () => {
        expect(classifyError(httpError(429)).retryable).toBe(true);
        expect(classifyError(httpError(503)).retryable).toBe(true);
    });

    it("treats client errors as permanent", () => {
        expect(classifyError(httpError(400)).retryable).toBe(false);
        expect(classifyError(httpError(401)).retryable).toBe(false);
        expect(classifyError(httpError(404)).retryable).toBe(false);
    });

    it("treats dropped connections as retryable", () => {
        const reset = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
        expect(classifyError(reset).retryable).toBe(true);
        expect(classifyError(new Error("something else")).retryable).toBe(false);
    });

    it("reads Retry-After from plain and fetch style headers", () => {
        expect(classifyError(httpError(429, { headers: { "retry-after": "2" } })).retryAfterMs).toBe(2000);
        const headers = new Headers({ "retry-after": "3" });
        expect(classifyError(httpError(429, { headers })).retryAfterMs).toBe(3000);
    });

    it("parses Retry-After given as seconds or as a date", () => {
        expect(parseRetryAfter("1.5", 0)).toBe(1500);
        expect(parseRetryAfter("Thu, 01 Jan 1970 00:00:10 GMT", 4000)).toBe(6000);
        expect(parseRetryAfter("not a date", 0)).toBeUndefined();
        expect(parseRetryAfter(undefined, 0)).toBeUndefined();
    });
});

describe("LlmGateway", () => {
    it("returns the first provider's text when it succeeds", async () => {
        const sleeps: number[] = [];
        const primary = scriptedProvider("gemini", ["hello"]);
        const backup = scriptedProvider("openai", ["unused"]);
        const result = await new LlmGateway([primary, backup], testOptions(sleeps)).generate("p");

        expect(result.ok && result.value.text).toBe("hello");
        expect(result.ok && result.value.provider).toBe("gemini");
        expect(backup.calls).toBe(0);
        expect(sleeps).toEqual([]);
    });

    it("retries a rate limited provider with growing backoff, then succeeds", async () => {
        const sleeps: number[] = [];
        const primary = scriptedProvider("gemini", [httpError(429), httpError(503), "recovered"]);
        const result = await new LlmGateway([primary], testOptions(sleeps)).generate("p");

        expect(result.ok && result.value.text).toBe("recovered");
        expect(primary.calls).toBe(3);
        // random() is 0.5, so the waits are half of the 100 and 200 ceilings
        expect(sleeps).toEqual([50, 100]);
        expect(result.ok && result.value.attempts.map((a) => a.outcome)).toEqual([
            "retryable_error",
            "retryable_error",
            "success",
        ]);
    });

    it("fails over to the next provider when retries run out", async () => {
        const sleeps: number[] = [];
        const primary = scriptedProvider("gemini", [httpError(503)]);
        const backup = scriptedProvider("openai", ["from backup"]);
        const result = await new LlmGateway([primary, backup], testOptions(sleeps)).generate("p");

        expect(result.ok && result.value.provider).toBe("openai");
        expect(primary.calls).toBe(3);
        expect(backup.calls).toBe(1);
        // two waits between the three primary attempts, none before the failover
        expect(sleeps).toHaveLength(2);
    });

    it("does not retry a permanent error, it fails over at once", async () => {
        const sleeps: number[] = [];
        const primary = scriptedProvider("gemini", [httpError(401)]);
        const backup = scriptedProvider("openai", ["from backup"]);
        const result = await new LlmGateway([primary, backup], testOptions(sleeps)).generate("p");

        expect(result.ok && result.value.provider).toBe("openai");
        expect(primary.calls).toBe(1);
        expect(sleeps).toEqual([]);
        expect(result.ok && result.value.attempts[0]?.outcome).toBe("fatal_error");
    });

    it("counts a call that exceeds the timeout as a retryable timeout", async () => {
        const sleeps: number[] = [];
        const slow = scriptedProvider("gemini", ["hang", "fast now"]);
        const result = await new LlmGateway([slow], testOptions(sleeps)).generate("p");

        expect(result.ok && result.value.text).toBe("fast now");
        expect(result.ok && result.value.attempts[0]?.outcome).toBe("timeout");
    });

    it("treats an empty completion as a failure and retries", async () => {
        const sleeps: number[] = [];
        const primary = scriptedProvider("gemini", ["   ", "real text"]);
        const result = await new LlmGateway([primary], testOptions(sleeps)).generate("p");

        expect(result.ok && result.value.text).toBe("real text");
        expect(result.ok && result.value.attempts[0]?.outcome).toBe("empty");
    });

    it("waits for the Retry-After value when the server sends one", async () => {
        const sleeps: number[] = [];
        const primary = scriptedProvider("gemini", [
            httpError(429, { headers: { "retry-after": "0.7" } }),
            "ok",
        ]);
        await new LlmGateway([primary], testOptions(sleeps)).generate("p");
        expect(sleeps).toEqual([700]);
    });

    it("caps Retry-After at the maximum delay", async () => {
        const sleeps: number[] = [];
        const primary = scriptedProvider("gemini", [
            httpError(429, { headers: { "retry-after": "3600" } }),
            "ok",
        ]);
        await new LlmGateway([primary], testOptions(sleeps)).generate("p");
        expect(sleeps).toEqual([1000]);
    });

    it("returns every attempt when the whole chain fails", async () => {
        const sleeps: number[] = [];
        const primary = scriptedProvider("gemini", [httpError(500)]);
        const backup = scriptedProvider("openai", [httpError(401)]);
        const result = await new LlmGateway([primary, backup], testOptions(sleeps)).generate("p");

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe("LLM_CHAIN_EXHAUSTED");
            expect(result.error.attempts).toHaveLength(4);
            expect(result.error.message).toContain("gemini -> openai");
        }
    });

    it("fails clearly when no provider is configured", async () => {
        const result = await new LlmGateway([], testOptions([])).generate("p");
        expect(!result.ok && result.error.code).toBe("LLM_NO_PROVIDERS");
    });

    it("reports each attempt through onAttempt", async () => {
        const seen: string[] = [];
        const primary = scriptedProvider("gemini", [httpError(429), "ok"]);
        await new LlmGateway([primary], {
            ...testOptions([]),
            onAttempt: (a) => seen.push(`${a.provider}:${a.attempt}:${a.outcome}`),
        }).generate("p");
        expect(seen).toEqual(["gemini:1:retryable_error", "gemini:2:success"]);
    });

    it("marks a failed chain as not retryable only when every attempt was permanent", async () => {
        const allPermanent = await new LlmGateway(
            [scriptedProvider("gemini", [httpError(401)]), scriptedProvider("openai", [httpError(403)])],
            testOptions([])
        ).generate("p");
        const oneTransient = await new LlmGateway(
            [scriptedProvider("gemini", [httpError(401)]), scriptedProvider("openai", [httpError(503)])],
            testOptions([])
        ).generate("p");

        expect(!allPermanent.ok && isChainRetryable(allPermanent.error)).toBe(false);
        expect(!oneTransient.ok && isChainRetryable(oneTransient.error)).toBe(true);
    });
});
