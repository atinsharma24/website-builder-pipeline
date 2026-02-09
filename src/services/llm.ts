import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

type LLMProvider = "gemini" | "openai";

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

/**
 * Unified content generation function supporting multiple LLM providers.
 * 
 * @param prompt - The prompt to send to the LLM
 * @param provider - 'gemini' or 'openai'
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
            model: modelName || process.env.GEMINI_MODEL || "gemini-2.0-flash",
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

    throw new Error(`Unsupported LLM provider: ${provider}`);
}
