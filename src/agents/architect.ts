import { err, ok, pipelineError, type PipelineError, type Result } from "../core/result.js";
import { isChainRetryable, type AttemptRecord, type LlmClient } from "../llm/types.js";
import type { BusinessInput } from "../schemas/business-input.js";
import { ArchitectOutputSchema, type ArchitectOutput } from "../schemas/architect-output.js";

/** What an agent hands back to the orchestrator. */
export interface AgentOutput<T> {
    readonly value: T;
    /** Every LLM call the agent made, including retries and failovers. */
    readonly attempts: readonly AttemptRecord[];
    /** How many times the agent had to ask the model to correct its output. */
    readonly repairs: number;
    /** True when the output is usable but not in the ideal shape. */
    readonly degraded: boolean;
}

export interface ArchitectOptions {
    /** Extra model calls allowed to fix output that fails validation. */
    readonly maxRepairAttempts: number;
}

/**
 * Build the Architect prompt. Pure: the same input always gives the same prompt.
 */
export function buildArchitectPrompt(input: BusinessInput): string {
    // Handle optional fields gracefully
    const ownerDisplay = input.owner_name || "The Team";

    // Handle missing contact info
    const contactNote =
        !input.phone && !input.email
            ? "\n**NOTE**: No phone/email provided; generate a contact form only."
            : !input.phone
                ? "\n**NOTE**: No phone provided; use email and a contact form."
                : !input.email
                    ? "\n**NOTE**: No email provided; use phone and a contact form."
                    : "";

    const photosSection =
        input.photos.length > 0
            ? `\n## Provided Photos:\n${input.photos.map((p, i) => `${i + 1}. ${p.url}${p.alt ? ` (${p.alt})` : ""}`).join("\n")}`
            : "\n## Photos: None provided - use professional placeholder images from picsum.photos or similar.";

    const hoursSection = input.hours
        ? `\n## Business Hours:\n${Object.entries(input.hours)
            .map(([day, time]) => `- ${day}: ${time}`)
            .join("\n")}`
        : "";

    const testimonialsSection =
        input.testimonials.length > 0
            ? `\n## Customer Testimonials (real, provided by the business, quote them exactly):\n${input.testimonials
                .map((t, i) => `${i + 1}. "${t.quote}" by ${t.author}`)
                .join("\n")}`
            : "\n## Customer Testimonials: None provided. Do not include a testimonials section.";

    return `You are an expert Website Architect specializing in creating stunning, conversion-optimized business websites.

## IMPORTANT INSTRUCTION
If specific business details (Owner Name, Phone, Email) are missing from the input, do NOT output 'undefined' or placeholders like '[Insert Name]'. Write professional copy that focuses on the brand and the services described below.

## GROUNDING RULES
Use only facts given in this prompt. Do NOT invent years in business, awards, certifications, customer counts, prices, reviews or testimonials. If no customer testimonials are provided below, do not plan a testimonials section.

## Business Information
- **Name**: ${input.business_name}
- **Category**: ${input.business_category ? input.business_category : "General / Unspecified (Infer from description)"}
- **Owner**: ${ownerDisplay}
- **Location**: ${input.address}, ${input.city}, ${input.state}
${input.phone ? `- **Phone**: ${input.phone}` : ""}
${input.email ? `- **Email**: ${input.email}` : ""}
${input.website ? `- **Website**: ${input.website}` : ""}
${contactNote}

## Business Description
${input.description}
${photosSection}
${hoursSection}
${testimonialsSection}

## Your Task
Create a detailed, production-ready website specification that will guide a web developer to create an absolutely STUNNING, CHARMING, and LUCRATIVE website for this business. The design must be so impressive that the business owner is WOWED at first sight.

## Output Format (JSON)
Return a JSON object with this exact structure:
{
  "website_generation_prompt": "A comprehensive prompt (500+ words) with detailed instructions for building the website",
  "site_style_guidelines": {
    "primary_color": "#hex",
    "secondary_color": "#hex",
    "accent_color": "#hex",
    "font_heading": "Font Name",
    "font_body": "Font Name",
    "tone": "professional|friendly|luxury|minimal|playful",
    "layout": "single-page|multi-section|split-hero"
  },
  "page_sections": [
    { "section_id": "hero", "section_name": "Hero Section", "copy_hints": "specific copy guidance", "required": true }
  ]
}

## Design Requirements to Include in Your Prompt
1. **Visual Impact**: The design must be jaw-dropping. Use bold colors, gradients, glassmorphism, or modern design trends appropriate for the business category.
2. **Professional Animations**: Include scroll-triggered animations, hover effects, subtle micro-interactions, and smooth transitions that feel premium.
3. **Charming Elements**: Add personality through custom icons, decorative elements, or unique typography treatments.
4. **Trust Signals**: Use only the testimonials and facts provided above. Never invent social proof.
5. **Strong CTAs**: Every section should guide the user toward contacting or visiting the business.
6. **Mobile-First**: Design must be flawless on mobile devices.
7. **Performance**: Use efficient CSS animations, lazy loading hints for images.

Return ONLY the JSON object, no additional text.`;

}

function describeIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
    return issues
        .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
}

/** Strip markdown code fences that models often wrap JSON in. */
export function stripCodeFences(text: string): string {
    return text
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
}

/**
 * Parse and validate raw model text against `ArchitectOutputSchema`.
 * Returns the reason as a string on failure, ready to be fed back to the model.
 */
export function parseArchitectOutput(raw: string): Result<ArchitectOutput, string> {
    const cleaned = stripCodeFences(raw);
    let parsed: unknown;
    try {
        parsed = JSON.parse(cleaned);
    } catch (cause) {
        return err(`Output is not valid JSON (${cause instanceof Error ? cause.message : "parse error"})`);
    }
    const validation = ArchitectOutputSchema.safeParse(parsed);
    if (!validation.success) {
        return err(`JSON does not match the required structure. ${describeIssues(validation.error.issues)}`);
    }
    return ok(validation.data);
}

/**
 * Architect Agent
 *
 * Turns structured business input into a validated website specification.
 * The model's reply is never trusted: it is parsed and checked with Zod. If it
 * fails, the validation errors are sent back to the model for a bounded number
 * of repair attempts. As a last resort the raw text is used as a plain prompt,
 * and the output is marked `degraded`.
 */
export async function runArchitect(
    input: BusinessInput,
    llm: LlmClient,
    options: ArchitectOptions = { maxRepairAttempts: 1 }
): Promise<Result<AgentOutput<ArchitectOutput>, PipelineError>> {
    const basePrompt = buildArchitectPrompt(input);
    const attempts: AttemptRecord[] = [];
    let prompt = basePrompt;
    let lastRaw = "";
    let lastProblem = "";

    for (let round = 0; round <= options.maxRepairAttempts; round++) {
        const response = await llm.generate(prompt);
        if (!response.ok) {
            attempts.push(...response.error.attempts);
            return err(
                pipelineError(
                    "architect",
                    response.error.code,
                    response.error.message,
                    isChainRetryable(response.error)
                )
            );
        }
        attempts.push(...response.value.attempts);
        lastRaw = response.value.text;

        const parsed = parseArchitectOutput(lastRaw);
        if (parsed.ok) {
            return ok({ value: parsed.value, attempts, repairs: round, degraded: false });
        }
        lastProblem = parsed.error;
        prompt = `${basePrompt}

## YOUR PREVIOUS REPLY WAS REJECTED
Reason: ${lastProblem}
Return ONLY a corrected JSON object with the exact structure described above.`;
    }

    // Last resort: use the raw text as the generation prompt, without style
    // guidelines or sections. Only acceptable when it is long enough to be one.
    const fallback = ArchitectOutputSchema.safeParse({
        website_generation_prompt: stripCodeFences(lastRaw),
    });
    if (fallback.success) {
        return ok({
            value: fallback.data,
            attempts,
            repairs: options.maxRepairAttempts,
            degraded: true,
        });
    }
    return err(
        pipelineError(
            "architect",
            "ARCHITECT_INVALID_OUTPUT",
            `Architect output failed validation after ${options.maxRepairAttempts} repair attempt(s). ${lastProblem}`,
            true
        )
    );
}

/**
 * Mock Architect Agent (for testing without LLM)
 */
export function mockArchitect(input: BusinessInput): ArchitectOutput {
    const ownerDisplay = input.owner_name || "The Team";
    const categoryDisplay = input.business_category || "General Business";

    return {
        website_generation_prompt: `
Create a breathtaking, conversion-focused website for "${input.business_name}" - a ${categoryDisplay} business in ${input.city}, ${input.state}.

## Business Profile
- **Name**: ${input.business_name}
- **Owner**: ${ownerDisplay}
- **Specialty**: ${categoryDisplay}
- **Story**: ${input.description}
- **Location**: ${input.address}, ${input.city}, ${input.state}
${input.phone ? `- **Phone**: ${input.phone}` : ""}
${input.email ? `- **Email**: ${input.email}` : ""}

## Design Vision
Create an ABSOLUTELY STUNNING, modern website that makes the business owner say "WOW!" The design should feel premium, trustworthy, and conversion-optimized.

## Required Sections

### 1. HERO SECTION
- Full-viewport height with striking visual impact
- Large, bold business name with animated text reveal
- Compelling tagline that communicates value
- Prominent CTA button with hover animation (glow effect)
- Background: Either a stunning gradient, subtle pattern, or hero image with overlay
- Floating decorative elements or animated shapes for visual interest

### 2. ABOUT / OUR STORY
- Split layout: Image on one side, content on other
- Owner's name and photo placeholder
- Years of experience / establishment highlighted
- Only facts stated in the description
- Fade-in animation on scroll

### 3. SERVICES / WHAT WE OFFER
- Card-based layout with hover lift effects
- Icons for each service (use emoji or SVG icons)
- Brief descriptions optimized for scanning
- Staggered animation on scroll

### 4. GALLERY / SHOWCASE
- ${input.photos.length > 0 ? `Use provided ${input.photos.length} photos` : "Use 6 placeholder images from picsum.photos"}
- Masonry or grid layout
- Lightbox-style hover effect
- Smooth image transitions

### 5. TESTIMONIALS
- ${input.testimonials.length > 0 ? `Quote the ${input.testimonials.length} provided testimonial(s) exactly` : "None provided, omit this section"}
- Never invent reviews, names or star ratings

### 6. CONTACT SECTION
- Business address prominently displayed
${input.phone ? "- Phone number (click-to-call on mobile)" : "- No phone provided — use a contact form"}
${input.email ? "- Email link" : "- No email provided — use a contact form"}
- Simple contact form (name, email, message)
- Operating hours if provided
- Embedded map placeholder

### 7. FOOTER
- Business name and copyright
- Quick links to sections
- Social media icon placeholders
- Back-to-top button with smooth scroll

## Animation Requirements
- Hero text: Fade-in and slide-up on load
- Sections: Fade-in with translateY on scroll
- Cards: Hover scale + shadow increase
- Buttons: Subtle pulse or glow on hover
- Images: Ken Burns effect on hero, zoom on gallery hover
- Use CSS animations and minimal JavaScript

## Technical Requirements
- Single HTML file with inline CSS
- Tailwind CSS via CDN
- Mobile-first responsive design
- Semantic HTML5 structure
- SEO meta tags (title, description, OG tags)
- Smooth scrolling navigation
- Accessibility: alt text, proper contrast, focus states
`,
        site_style_guidelines: {
            primary_color: "#2563eb",
            secondary_color: "#f8fafc",
            accent_color: "#f59e0b",
            font_heading: "Playfair Display",
            font_body: "Inter",
            tone: "professional",
            layout: "single-page",
        },
        page_sections: [
            {
                section_id: "hero",
                section_name: "Hero Banner",
                copy_hints: "Business name, tagline, primary CTA",
                required: true,
            },
            {
                section_id: "about",
                section_name: "Our Story",
                copy_hints: "Owner intro, business history, values",
                required: true,
            },
            {
                section_id: "services",
                section_name: "Services",
                copy_hints: "3-6 service cards with icons",
                required: true,
            },
            {
                section_id: "gallery",
                section_name: "Gallery",
                copy_hints: "Photo grid with hover effects",
                required: true,
            },
            {
                section_id: "testimonials",
                section_name: "Testimonials",
                copy_hints: "Only testimonials provided by the business, quoted exactly",
                required: false,
            },
            {
                section_id: "contact",
                section_name: "Contact Us",
                copy_hints: "Address, form, hours",
                required: true,
            },
            {
                section_id: "footer",
                section_name: "Footer",
                copy_hints: "Links, social, copyright",
                required: true,
            },
        ],
    };
}
