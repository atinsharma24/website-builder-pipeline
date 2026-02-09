import { z } from "zod";

/**
 * PipelineResult Schema
 * Final output from the complete pipeline
 */
export const PipelineResultSchema = z.object({
    status: z.enum(["success", "error", "partial"]),
    run_id: z.string(),
    business_slug: z.string().optional(),
    storage_path: z.string().optional(),
    public_url: z.string().url().optional(),
    html_size_bytes: z.number().int().positive().optional(),
    generated_at: z.string().datetime().optional(),
    error_message: z.string().optional(),
    error_phase: z
        .enum(["validation", "architect", "builder", "upload"])
        .optional(),
});

export type PipelineResult = z.infer<typeof PipelineResultSchema>;

/**
 * Helper to create success result
 */
export function createSuccessResult(params: {
    run_id: string;
    business_slug: string;
    storage_path: string;
    public_url: string;
    html_size_bytes: number;
}): PipelineResult {
    return {
        status: "success",
        run_id: params.run_id,
        business_slug: params.business_slug,
        storage_path: params.storage_path,
        public_url: params.public_url,
        html_size_bytes: params.html_size_bytes,
        generated_at: new Date().toISOString(),
    };
}

/**
 * Helper to create error result
 */
export function createErrorResult(params: {
    run_id: string;
    error_message: string;
    error_phase: "validation" | "architect" | "builder" | "upload";
}): PipelineResult {
    return {
        status: "error",
        run_id: params.run_id,
        error_message: params.error_message,
        error_phase: params.error_phase,
        generated_at: new Date().toISOString(),
    };
}
