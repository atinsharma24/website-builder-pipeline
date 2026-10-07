import { z } from "zod";

/**
 * PipelineResult Schema
 * Final output from the complete pipeline
 */
export const ErrorPhaseSchema = z.enum(["validation", "architect", "builder", "quality", "upload"]);

export const PipelineResultSchema = z.object({
    status: z.enum(["success", "error", "partial"]),
    run_id: z.string(),
    business_slug: z.string().optional(),
    storage_path: z.string().optional(),
    public_url: z.string().url().optional(),
    html_size_bytes: z.number().int().positive().optional(),
    generated_at: z.string().datetime().optional(),
    error_message: z.string().optional(),
    error_phase: ErrorPhaseSchema.optional(),
    /** Stable machine readable error code, for example LLM_CHAIN_EXHAUSTED. */
    error_code: z.string().optional(),
    /** True when running the same request again could succeed. */
    retryable: z.boolean().optional(),
    /** Non blocking findings from the HTML quality gate. */
    warnings: z.array(z.string()).optional(),
    /** How many times the Builder was asked to repair its own output. */
    repair_attempts: z.number().int().min(0).optional(),
    /** True when this response was served from an earlier identical run. */
    idempotent_replay: z.boolean().optional(),
});

export type PipelineResult = z.infer<typeof PipelineResultSchema>;
export type PipelineErrorPhase = z.infer<typeof ErrorPhaseSchema>;

/**
 * Helper to create success result
 */
export function createSuccessResult(params: {
    run_id: string;
    business_slug: string;
    html_size_bytes: number;
    storage_path?: string | undefined;
    public_url?: string | undefined;
    warnings?: readonly string[] | undefined;
    repair_attempts?: number | undefined;
}): PipelineResult {
    return {
        status: "success",
        run_id: params.run_id,
        business_slug: params.business_slug,
        html_size_bytes: params.html_size_bytes,
        generated_at: new Date().toISOString(),
        ...(params.storage_path !== undefined ? { storage_path: params.storage_path } : {}),
        ...(params.public_url !== undefined ? { public_url: params.public_url } : {}),
        ...(params.warnings !== undefined && params.warnings.length > 0
            ? { warnings: [...params.warnings] }
            : {}),
        ...(params.repair_attempts !== undefined ? { repair_attempts: params.repair_attempts } : {}),
    };
}

/**
 * Helper to create error result
 */
export function createErrorResult(params: {
    run_id: string;
    error_message: string;
    error_phase: PipelineErrorPhase;
    business_slug?: string | undefined;
    error_code?: string | undefined;
    retryable?: boolean | undefined;
    repair_attempts?: number | undefined;
}): PipelineResult {
    return {
        status: "error",
        run_id: params.run_id,
        error_message: params.error_message,
        error_phase: params.error_phase,
        generated_at: new Date().toISOString(),
        ...(params.business_slug !== undefined ? { business_slug: params.business_slug } : {}),
        ...(params.error_code !== undefined ? { error_code: params.error_code } : {}),
        ...(params.retryable !== undefined ? { retryable: params.retryable } : {}),
        ...(params.repair_attempts !== undefined ? { repair_attempts: params.repair_attempts } : {}),
    };
}
