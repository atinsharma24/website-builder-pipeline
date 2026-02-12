import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

type LLMProvider = "gemini" | "openai" | "claude";

const geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

// Lazy-loaded OpenAI client
let openaiClient: any = null;

async function getOpenAIClient(): Promise<any> {
    if (!openaiClient) {
        // Dynamic import to avoid loading OpenAI at module initialization
        const { default: OpenAI } = await import("openai");
        openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    return openaiClient;
}

// Lazy-loaded Anthropic client
let anthropicClient: any = null;

async function getAnthropicClient(): Promise<any> {
    if (!anthropicClient) {
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        if (!process.env.ANTHROPIC_API_KEY) {
            throw new Error("ANTHROPIC_API_KEY is not set in environment variables");
        }
        anthropicClient = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
        });
    }
    return anthropicClient;
}

/**
 * Unified content generation function supporting multiple LLM providers.
 * 
 * @param prompt - The prompt to send to the LLM
 * @param provider - 'gemini', 'openai', or 'claude'
 * @param modelName - Optional model name override (uses env defaults if not provided)
 * @returns The generated text content
 */
export async function generateContent(
    prompt: string,
    provider: LLMProvider,
    modelName?: string
): Promise<string> {
    if (provider === "gemini") {
        const model = geminiClient.getGenerativeModel({
            model: modelName || process.env.GEMINI_MODEL || "gemini-3-pro-preview",
        });
        const result = await model.generateContent(prompt);
        return result.response.text();
    }

    if (provider === "openai") {
        const client = await getOpenAIClient();
        const response = await client.chat.completions.create({
            model: modelName || process.env.OPENAI_MODEL || "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
        });
        return response.choices[0]?.message?.content ?? "";
    }

    if (provider === "claude") {
        const client = await getAnthropicClient();
        const response = await client.messages.create({
            model: modelName || process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20240620",
            max_tokens: 4096,
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
        });
        // Anthropic returns content as an array of content blocks
        const textBlock = response.content.find((block: any) => block.type === "text");
        return textBlock?.text ?? "";
    }

    throw new Error(`Unsupported LLM provider: ${provider}`);
}
