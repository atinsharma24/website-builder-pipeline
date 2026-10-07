/**
 * Test doubles shared by the test files. Nothing here is used in production.
 */
import { err, ok } from "../core/result.js";
import type { AttemptRecord, LlmClient, LlmProvider } from "../llm/types.js";
import type { Uploader, UploadOutcome } from "../pipeline/orchestrator.js";

/** A complete, valid page that passes the quality gate. */
export const VALID_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="A test page used by the unit tests of the pipeline">
  <title>Sharma Optics</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
  <header id="hero"><h1>Sharma Optics</h1><p>Designer frames and eye examinations in Indore.</p></header>
  <main>
    <section id="about"><h2>About</h2><p>An optical store on MG Road.</p></section>
    <section id="contact"><h2>Contact</h2><p>123 MG Road, Indore, Madhya Pradesh</p></section>
  </main>
  <footer id="footer"><p>Sharma Optics</p></footer>
</body>
</html>`;

export const VALID_SPEC_JSON = JSON.stringify({
    website_generation_prompt: "Build a single page website for Sharma Optics. ".repeat(5),
    site_style_guidelines: { primary_color: "#2563eb", tone: "professional", layout: "single-page" },
    page_sections: [
        { section_id: "hero", section_name: "Hero", required: true },
        { section_id: "contact", section_name: "Contact", required: true },
    ],
});

export const VALID_INPUT = {
    business_name: "Sharma Optics",
    address: "123 MG Road, Near City Center",
    city: "Indore",
    state: "Madhya Pradesh",
    description: "Optical store offering designer frames, contact lenses and eye examinations.",
};

const attempt = (provider: string, outcome: AttemptRecord["outcome"]): AttemptRecord => ({
    provider,
    attempt: 1,
    durationMs: 1,
    outcome,
});

export interface ScriptedClient extends LlmClient {
    readonly prompts: string[];
}

/**
 * An LlmClient that replies with the given texts in order.
 * An `Error` entry makes that call fail as if the whole provider chain was exhausted.
 */
export function scriptedClient(replies: ReadonlyArray<string | Error>): ScriptedClient {
    const prompts: string[] = [];
    let index = 0;
    return {
        prompts,
        async generate(prompt) {
            prompts.push(prompt);
            const reply = replies[Math.min(index, replies.length - 1)];
            index += 1;
            if (reply === undefined || reply instanceof Error) {
                return err({
                    code: "LLM_CHAIN_EXHAUSTED",
                    message: reply?.message ?? "no scripted reply",
                    attempts: [attempt("fake", "retryable_error")],
                });
            }
            return ok({ text: reply, provider: "fake", attempts: [attempt("fake", "success")] });
        },
    };
}

export interface ScriptedProvider extends LlmProvider {
    calls: number;
}

/** An LlmProvider whose calls follow a script of texts and thrown errors. */
export function scriptedProvider(
    name: string,
    script: ReadonlyArray<string | Error | "hang">
): ScriptedProvider {
    const provider: ScriptedProvider = {
        name,
        calls: 0,
        async generate() {
            const step = script[Math.min(provider.calls, script.length - 1)];
            provider.calls += 1;
            if (step === "hang") return new Promise<string>(() => {});
            if (step instanceof Error) throw step;
            return step ?? "";
        },
    };
    return provider;
}

export function httpError(status: number, extra: Record<string, unknown> = {}): Error {
    return Object.assign(new Error(`HTTP ${status}`), { status, ...extra });
}

export interface RecordingUploader extends Uploader {
    readonly uploads: Array<{ slug: string; runId: string; bytes: number }>;
}

export function recordingUploader(outcome?: Partial<UploadOutcome>): RecordingUploader {
    const uploads: RecordingUploader["uploads"] = [];
    return {
        uploads,
        async checkBucketExists() {
            return true;
        },
        async uploadWebsite(slug, html, runId) {
            uploads.push({ slug, runId, bytes: Buffer.byteLength(html, "utf-8") });
            return {
                success: true,
                publicUrl: `https://storage.example/${slug}/index.html`,
                storagePath: `${slug}/index.html`,
                sizeBytes: Buffer.byteLength(html, "utf-8"),
                ...outcome,
            };
        },
    };
}
