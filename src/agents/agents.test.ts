import { describe, expect, it } from "vitest";
import { BusinessInputSchema } from "../schemas/business-input.js";
import { scriptedClient, VALID_INPUT, VALID_SPEC_JSON } from "../testing/fakes.js";
import { buildArchitectPrompt, parseArchitectOutput, runArchitect } from "./architect.js";
import { buildBuilderPrompt, cleanLLMOutput, runBuilder } from "./builder.js";

const input = BusinessInputSchema.parse(VALID_INPUT);
const spec = JSON.parse(VALID_SPEC_JSON) as { website_generation_prompt: string };

describe("parseArchitectOutput", () => {
    it("accepts valid JSON, with or without a markdown fence", () => {
        expect(parseArchitectOutput(VALID_SPEC_JSON).ok).toBe(true);
        expect(parseArchitectOutput("```json\n" + VALID_SPEC_JSON + "\n```").ok).toBe(true);
    });

    it("explains why text that is not JSON was rejected", () => {
        const result = parseArchitectOutput("Sure! Here is your website plan.");
        expect(!result.ok && result.error).toContain("not valid JSON");
    });

    it("names the field that breaks the schema", () => {
        const result = parseArchitectOutput(
            JSON.stringify({ website_generation_prompt: "too short", site_style_guidelines: { primary_color: "blue" } })
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain("website_generation_prompt");
            expect(result.error).toContain("site_style_guidelines.primary_color");
        }
    });
});

describe("buildArchitectPrompt", () => {
    it("is deterministic", () => {
        expect(buildArchitectPrompt(input)).toBe(buildArchitectPrompt(input));
    });

    it("tells the model not to invent testimonials when none are given", () => {
        const prompt = buildArchitectPrompt(input);
        expect(prompt).toContain("Customer Testimonials: None provided");
        expect(prompt).toContain("Do NOT invent");
        expect(prompt).not.toMatch(/hallucinate/i);
    });

    it("passes provided testimonials through word for word", () => {
        const withQuotes = BusinessInputSchema.parse({
            ...VALID_INPUT,
            testimonials: [{ author: "R. Verma", quote: "Fitted my lenses in twenty minutes." }],
        });
        expect(buildArchitectPrompt(withQuotes)).toContain('"Fitted my lenses in twenty minutes." by R. Verma');
    });
});

describe("runArchitect", () => {
    it("returns the validated spec on a good first reply", async () => {
        const llm = scriptedClient([VALID_SPEC_JSON]);
        const result = await runArchitect(input, llm, { maxRepairAttempts: 1 });
        expect(result.ok && result.value.repairs).toBe(0);
        expect(result.ok && result.value.degraded).toBe(false);
        expect(llm.prompts).toHaveLength(1);
    });

    it("sends the validation error back and accepts the corrected reply", async () => {
        const llm = scriptedClient(['{"website_generation_prompt": "short"}', VALID_SPEC_JSON]);
        const result = await runArchitect(input, llm, { maxRepairAttempts: 1 });

        expect(result.ok && result.value.repairs).toBe(1);
        expect(llm.prompts).toHaveLength(2);
        expect(llm.prompts[1]).toContain("YOUR PREVIOUS REPLY WAS REJECTED");
        expect(llm.prompts[1]).toContain("website_generation_prompt");
    });

    it("falls back to the raw text as a prompt, marked degraded, when repairs do not help", async () => {
        const prose = "Build a warm, trustworthy single page site for an optical store. ".repeat(4);
        const llm = scriptedClient([prose]);
        const result = await runArchitect(input, llm, { maxRepairAttempts: 1 });

        expect(result.ok && result.value.degraded).toBe(true);
        expect(result.ok && result.value.value.website_generation_prompt).toContain("optical store");
        expect(llm.prompts).toHaveLength(2);
    });

    it("fails when the output is unusable even as a plain prompt", async () => {
        const result = await runArchitect(input, scriptedClient(["nope"]), { maxRepairAttempts: 1 });
        expect(!result.ok && result.error.code).toBe("ARCHITECT_INVALID_OUTPUT");
        expect(!result.ok && result.error.phase).toBe("architect");
    });

    it("stops at once when the provider chain is exhausted", async () => {
        const llm = scriptedClient([new Error("all providers down")]);
        const result = await runArchitect(input, llm, { maxRepairAttempts: 2 });
        expect(!result.ok && result.error.code).toBe("LLM_CHAIN_EXHAUSTED");
        expect(llm.prompts).toHaveLength(1);
    });
});

describe("builder", () => {
    it("strips markdown fences from model output", () => {
        expect(cleanLLMOutput("```html\n<!DOCTYPE html><html></html>\n```")).toBe("<!DOCTYPE html><html></html>");
    });

    it("adds the repair notes to the prompt only on a repair attempt", () => {
        const first = buildBuilderPrompt(spec);
        const repair = buildBuilderPrompt(spec, "1. Missing a non empty <title>");
        expect(first).not.toContain("REJECTED BY AUTOMATED CHECKS");
        expect(repair).toContain("REJECTED BY AUTOMATED CHECKS");
        expect(repair).toContain("1. Missing a non empty <title>");
    });

    it("forbids invented testimonials in the prompt", () => {
        const prompt = buildBuilderPrompt(spec);
        expect(prompt).toContain("Never invent reviews");
        expect(prompt).not.toContain("Indian names");
    });

    it("returns cleaned HTML and maps a provider failure to the builder phase", async () => {
        const good = await runBuilder(spec, scriptedClient(["```html\n<p>hi</p>\n```"]));
        expect(good.ok && good.value.value).toBe("<p>hi</p>");

        const bad = await runBuilder(spec, scriptedClient([new Error("down")]));
        expect(!bad.ok && bad.error.phase).toBe("builder");
    });
});
