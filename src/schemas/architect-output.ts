import { z } from "zod";

/**
 * ArchitectOutput Schema
 * Output from the Architect Agent - guides the Builder Agent
 */
export const SiteStyleGuidelinesSchema = z.object({
    primary_color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color")
        .optional(),
    secondary_color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color")
        .optional(),
    accent_color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color")
        .optional(),
    font_heading: z.string().optional(),
    font_body: z.string().optional(),
    tone: z
        .enum(["professional", "friendly", "luxury", "minimal", "playful"])
        .optional(),
    layout: z.enum(["single-page", "multi-section", "split-hero"]).optional(),
});

export const PageSectionSchema = z.object({
    section_id: z.string(),
    section_name: z.string(),
    copy_hints: z.string().optional(),
    required: z.boolean().default(true),
});

export const ArchitectOutputSchema = z.object({
    website_generation_prompt: z
        .string()
        .min(100, "Prompt must be at least 100 characters"),
    site_style_guidelines: SiteStyleGuidelinesSchema.optional(),
    page_sections: z.array(PageSectionSchema).optional(),
});

export type ArchitectOutput = z.infer<typeof ArchitectOutputSchema>;
export type SiteStyleGuidelines = z.infer<typeof SiteStyleGuidelinesSchema>;
export type PageSection = z.infer<typeof PageSectionSchema>;
