/**
 * Vendor adapters. Each one hides an SDK behind the `LlmProvider` contract.
 *
 * SDK clients are created on first use, so the server starts (and mock mode
 * and tests run) without any API key. The SDKs' own retry logic is switched
 * off where they have one, because the gateway owns the retry policy. Two
 * layers of retries would multiply the number of calls.
 */
import type { LlmProvider, ProviderName } from "./types.js";
import { PROVIDER_NAMES } from "./types.js";

/** The subset of environment variables the adapters read. */
export interface ProviderEnv {
    readonly GEMINI_API_KEY?: string | undefined;
    readonly GEMINI_MODEL?: string | undefined;
    readonly OPENAI_API_KEY?: string | undefined;
    readonly OPENAI_MODEL?: string | undefined;
    readonly ANTHROPIC_API_KEY?: string | undefined;
    readonly ANTHROPIC_MODEL?: string | undefined;
    readonly ANTHROPIC_MAX_TOKENS?: string | undefined;
}

/**
 * Models used when GEMINI_MODEL, OPENAI_MODEL or ANTHROPIC_MODEL is unset.
 * Vendors retire model names, so check their model pages when a call fails
 * with "model not found" and override the variable rather than this default.
 */
export const DEFAULT_MODELS: Readonly<Record<ProviderName, string>> = {
    gemini: "gemini-3.8-flash",
    openai: "gpt-6-astra",
    claude: "claude-sonnet-5-5",
};

/** Thrown when a provider is selected but its key is missing. Never retried. */
export class ProviderConfigError extends Error {
    readonly status = 401;
    constructor(message: string) {
        super(message);
        this.name = "ProviderConfigError";
    }
}

function requireKey(value: string | undefined, name: string): string {
    if (value === undefined || value.trim() === "") {
        throw new ProviderConfigError(`${name} is not set`);
    }
    return value;
}

function createGeminiProvider(env: ProviderEnv): LlmProvider {
    return {
        name: "gemini",
        async generate(prompt, signal) {
            const apiKey = requireKey(env.GEMINI_API_KEY, "GEMINI_API_KEY");
            const { GoogleGenerativeAI } = await import("@google/generative-ai");
            const client = new GoogleGenerativeAI(apiKey);
            const model = client.getGenerativeModel({
                model: env.GEMINI_MODEL?.trim() || DEFAULT_MODELS.gemini,
                generationConfig: { maxOutputTokens: 65536 },
            });
            const result = await model.generateContent(prompt, { signal });
            return result.response.text();
        },
    };
}

function createOpenAiProvider(env: ProviderEnv): LlmProvider {
    return {
        name: "openai",
        async generate(prompt, signal) {
            const apiKey = requireKey(env.OPENAI_API_KEY, "OPENAI_API_KEY");
            const { default: OpenAI } = await import("openai");
            const client = new OpenAI({ apiKey, maxRetries: 0 });
            const response = await client.chat.completions.create(
                {
                    model: env.OPENAI_MODEL?.trim() || DEFAULT_MODELS.openai,
                    messages: [{ role: "user", content: prompt }],
                },
                { signal }
            );
            return response.choices[0]?.message?.content ?? "";
        },
    };
}

function createClaudeProvider(env: ProviderEnv): LlmProvider {
    return {
        name: "claude",
        async generate(prompt, signal) {
            const apiKey = requireKey(env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY");
            const { default: Anthropic } = await import("@anthropic-ai/sdk");
            const client = new Anthropic({ apiKey, maxRetries: 0 });
            const maxTokens = Number(env.ANTHROPIC_MAX_TOKENS ?? "8192");
            const response = await client.messages.create(
                {
                    model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODELS.claude,
                    max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 8192,
                    messages: [{ role: "user", content: prompt }],
                },
                { signal }
            );
            for (const block of response.content) {
                if (block.type === "text") return block.text;
            }
            return "";
        },
    };
}

export function createProvider(name: ProviderName, env: ProviderEnv): LlmProvider {
    switch (name) {
        case "gemini":
            return createGeminiProvider(env);
        case "openai":
            return createOpenAiProvider(env);
        case "claude":
            return createClaudeProvider(env);
    }
}

function isProviderName(value: string): value is ProviderName {
    return (PROVIDER_NAMES as readonly string[]).includes(value);
}

/**
 * Parse a failover chain such as "gemini,openai" into ordered provider names.
 * Unknown names throw at startup, so a typo is caught before the first request.
 * Duplicates are dropped, keeping the first position.
 */
export function parseProviderChain(spec: string): ProviderName[] {
    const names: ProviderName[] = [];
    for (const raw of spec.split(",")) {
        const name = raw.trim().toLowerCase();
        if (name === "") continue;
        if (!isProviderName(name)) {
            throw new Error(
                `Unknown LLM provider "${name}". Expected one of: ${PROVIDER_NAMES.join(", ")}`
            );
        }
        if (!names.includes(name)) names.push(name);
    }
    if (names.length === 0) {
        throw new Error("LLM provider chain is empty");
    }
    return names;
}
