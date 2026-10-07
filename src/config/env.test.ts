import { describe, expect, it } from "vitest";
import { parseProviderChain } from "../llm/providers.js";
import { loadConfig } from "./env.js";

describe("loadConfig", () => {
    it("uses safe defaults when nothing is set", () => {
        const config = loadConfig({});
        expect(config.port).toBe(4000);
        expect(config.architectChain).toEqual(["gemini"]);
        expect(config.builderChain).toEqual(["gemini"]);
        expect(config.llm).toEqual({ maxAttemptsPerProvider: 3, baseDelayMs: 500, maxDelayMs: 8000, timeoutMs: 120000 });
        expect(config.maxRepairAttempts).toBe(1);
        expect(config.idempotencyTtlMs).toBe(86_400_000);
        expect(config.apiKey).toBeUndefined();
        expect(config.allowedScriptHosts).toBeUndefined();
    });

    it("still honours the old single provider variables", () => {
        const config = loadConfig({ ARCHITECT_LLM_PROVIDER: "claude", BUILDER_LLM_PROVIDER: "openai" });
        expect(config.architectChain).toEqual(["claude"]);
        expect(config.builderChain).toEqual(["openai"]);
    });

    it("prefers a failover chain over the single provider variable", () => {
        const config = loadConfig({ BUILDER_LLM_PROVIDER: "openai", BUILDER_LLM_CHAIN: "gemini, claude ,openai" });
        expect(config.builderChain).toEqual(["gemini", "claude", "openai"]);
    });

    it("stops with a clear message on a bad number", () => {
        expect(() => loadConfig({ PORT: "eighty" })).toThrow(/PORT: must be an integer between 1 and 65535/);
        expect(() => loadConfig({ LLM_MAX_ATTEMPTS: "0" })).toThrow(/LLM_MAX_ATTEMPTS/);
    });

    it("stops on an unknown provider name instead of failing on the first request", () => {
        expect(() => loadConfig({ ARCHITECT_LLM_CHAIN: "gemini,gpt5" })).toThrow(/Unknown LLM provider "gpt5"/);
    });

    it("treats blank values as not set and parses the script allow list", () => {
        const config = loadConfig({ PIPELINE_API_KEY: "  ", ALLOWED_SCRIPT_HOSTS: "cdn.tailwindcss.com, Kit.Example " });
        expect(config.apiKey).toBeUndefined();
        expect(config.allowedScriptHosts).toEqual(["cdn.tailwindcss.com", "kit.example"]);
    });
});

describe("parseProviderChain", () => {
    it("keeps order and drops duplicates", () => {
        expect(parseProviderChain("openai,gemini,openai")).toEqual(["openai", "gemini"]);
    });

    it("rejects an empty chain", () => {
        expect(() => parseProviderChain(" , ")).toThrow(/empty/);
    });
});
