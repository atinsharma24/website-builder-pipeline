import { beforeEach, describe, expect, it, vi } from "vitest";

// The SDKs are replaced so these tests record which model each adapter asks
// for without making a network call.
const calls = vi.hoisted(() => ({ gemini: [] as string[], openai: [] as string[], claude: [] as string[] }));

vi.mock("@google/generative-ai", () => ({
    GoogleGenerativeAI: class {
        getGenerativeModel({ model }: { model: string }) {
            calls.gemini.push(model);
            return { generateContent: async () => ({ response: { text: () => "ok" } }) };
        }
    },
}));

vi.mock("openai", () => ({
    default: class {
        chat = {
            completions: {
                create: async ({ model }: { model: string }) => {
                    calls.openai.push(model);
                    return { choices: [{ message: { content: "ok" } }] };
                },
            },
        };
    },
}));

vi.mock("@anthropic-ai/sdk", () => ({
    default: class {
        messages = {
            create: async ({ model }: { model: string }) => {
                calls.claude.push(model);
                return { content: [{ type: "text", text: "ok" }] };
            },
        };
    },
}));

import { createProvider, DEFAULT_MODELS, ProviderConfigError } from "./providers.js";

const keys = { GEMINI_API_KEY: "k", OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k" };
const signal = new AbortController().signal;

describe("provider adapters", () => {
    beforeEach(() => {
        calls.gemini.length = 0;
        calls.openai.length = 0;
        calls.claude.length = 0;
    });

    it("use the default model when no model variable is set", async () => {
        await createProvider("gemini", keys).generate("p", signal);
        await createProvider("openai", keys).generate("p", signal);
        await createProvider("claude", keys).generate("p", signal);
        expect(calls.gemini).toEqual([DEFAULT_MODELS.gemini]);
        expect(calls.openai).toEqual([DEFAULT_MODELS.openai]);
        expect(calls.claude).toEqual([DEFAULT_MODELS.claude]);
    });

    it("use the model variable when it is set", async () => {
        const env = { ...keys, GEMINI_MODEL: "g", OPENAI_MODEL: "o", ANTHROPIC_MODEL: "c" };
        await createProvider("gemini", env).generate("p", signal);
        await createProvider("openai", env).generate("p", signal);
        await createProvider("claude", env).generate("p", signal);
        expect([calls.gemini, calls.openai, calls.claude]).toEqual([["g"], ["o"], ["c"]]);
    });

    it("fall back to the default model when the model variable is empty", async () => {
        const env = { ...keys, GEMINI_MODEL: "", OPENAI_MODEL: "  ", ANTHROPIC_MODEL: "" };
        await createProvider("gemini", env).generate("p", signal);
        await createProvider("openai", env).generate("p", signal);
        await createProvider("claude", env).generate("p", signal);
        expect([calls.gemini, calls.openai, calls.claude]).toEqual([
            [DEFAULT_MODELS.gemini],
            [DEFAULT_MODELS.openai],
            [DEFAULT_MODELS.claude],
        ]);
    });

    it("fail with a config error when the key is missing", async () => {
        await expect(createProvider("gemini", {}).generate("p", signal)).rejects.toBeInstanceOf(
            ProviderConfigError
        );
    });
});
