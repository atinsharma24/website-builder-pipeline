import {
    BusinessInputSchema,
    type BusinessInput,
} from "../schemas/business-input.js";
import {
    type ArchitectOutput,
} from "../schemas/architect-output.js";
import {
    type PipelineResult,
    createSuccessResult,
    createErrorResult,
} from "../schemas/pipeline-result.js";
import { runArchitect, mockArchitect, runBuilder, mockBuilder } from "../agents/index.js";
import { slugify, generateRunId, uploadWebsite, checkBucketExists } from "../services/index.js";
import "dotenv/config";

/**
 * Pipeline options
 */
export interface PipelineOptions {
    useMock?: boolean; // Use mock agents instead of real LLM
    skipUpload?: boolean; // Skip Supabase upload (for local testing)
    outputDir?: string; // Local directory to save HTML (optional)
}

/**
 * Pipeline execution context (for logging and tracking)
 */
interface PipelineContext {
    runId: string;
    businessSlug: string;
    startTime: number;
}

/**
 * Log with run context
 */
function log(ctx: PipelineContext, message: string, level: "info" | "error" | "success" = "info"): void {
    const elapsed = ((Date.now() - ctx.startTime) / 1000).toFixed(2);
    const prefix = level === "error" ? "❌" : level === "success" ? "✅" : "📋";
    console.log(`[${ctx.runId}] [${elapsed}s] ${prefix} ${message}`);
}

/**
 * Main Pipeline Orchestrator
 * 
 * Executes the complete pipeline:
 * 1. Validate input
 * 2. Run Architect Agent
 * 3. Run Builder Agent
 * 4. Upload to Supabase
 */
export async function runPipeline(
    rawInput: unknown,
    options: PipelineOptions = {}
): Promise<PipelineResult> {
    const runId = generateRunId();
    const startTime = Date.now();

    // Temporary context before we have businessSlug
    let ctx: PipelineContext = {
        runId,
        businessSlug: "unknown",
        startTime,
    };

    console.log(`\n${"=".repeat(60)}`);
    console.log(`🚀 Starting Website Generation Pipeline`);
    console.log(`   Run ID: ${runId}`);
    console.log(`   Mode: ${options.useMock ? "MOCK" : "PRODUCTION"}`);
    console.log(`${"=".repeat(60)}\n`);

    // ============================================
    // PHASE 1: VALIDATION
    // ============================================
    log(ctx, "Phase 1: Validating input...");

    const validation = BusinessInputSchema.safeParse(rawInput);

    if (!validation.success) {
        const errorMessages = validation.error.issues
            .map((e) => `${e.path.join(".")}: ${e.message}`)
            .join("; ");

        log(ctx, `Validation failed: ${errorMessages}`, "error");

        return createErrorResult({
            run_id: runId,
            error_message: `Validation failed: ${errorMessages}`,
            error_phase: "validation",
        });
    }

    const input: BusinessInput = validation.data;
    ctx.businessSlug = slugify(input.business_name);

    log(ctx, `Input validated for: ${input.business_name}`, "success");
    log(ctx, `Business slug: ${ctx.businessSlug}`);

    // ============================================
    // PHASE 2: ARCHITECT AGENT
    // ============================================
    log(ctx, "Phase 2: Running Architect Agent...");

    let architectOutput: ArchitectOutput;

    try {
        if (options.useMock) {
            log(ctx, "Using mock Architect Agent");
            architectOutput = mockArchitect(input);
        } else {
            architectOutput = await runArchitect(input);
        }

        log(ctx, "Architect Agent completed", "success");
        log(ctx, `Prompt length: ${architectOutput.website_generation_prompt.length} chars`);

        if (architectOutput.site_style_guidelines) {
            log(ctx, `Style: ${architectOutput.site_style_guidelines.tone || "professional"}, Colors: ${architectOutput.site_style_guidelines.primary_color || "default"}`);
        }

        if (architectOutput.page_sections) {
            log(ctx, `Sections: ${architectOutput.page_sections.map((s) => s.section_id).join(", ")}`);
        }
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        log(ctx, `Architect Agent failed: ${errorMessage}`, "error");

        return createErrorResult({
            run_id: runId,
            error_message: `Architect Agent failed: ${errorMessage}`,
            error_phase: "architect",
        });
    }

    // ============================================
    // PHASE 3: BUILDER AGENT
    // ============================================
    log(ctx, "Phase 3: Running Builder Agent...");

    let htmlContent: string;

    try {
        if (options.useMock) {
            log(ctx, "Using mock Builder Agent");
            htmlContent = mockBuilder(architectOutput);
        } else {
            htmlContent = await runBuilder(architectOutput);
        }

        log(ctx, "Builder Agent completed", "success");
        log(ctx, `HTML size: ${htmlContent.length} chars`);

        // Basic validation
        if (!htmlContent.includes("<!DOCTYPE html") && !htmlContent.includes("<!doctype html")) {
            log(ctx, "Warning: Generated HTML may be invalid (missing DOCTYPE)", "error");
        }

        // Save locally if outputDir is specified
        if (options.outputDir) {
            const fs = await import("node:fs");
            const path = await import("node:path");

            const outputPath = path.join(options.outputDir, ctx.businessSlug, runId);
            fs.mkdirSync(outputPath, { recursive: true });
            fs.writeFileSync(path.join(outputPath, "index.html"), htmlContent);
            log(ctx, `Saved locally to: ${outputPath}/index.html`);
        }
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        log(ctx, `Builder Agent failed: ${errorMessage}`, "error");

        return createErrorResult({
            run_id: runId,
            error_message: `Builder Agent failed: ${errorMessage}`,
            error_phase: "builder",
        });
    }

    // ============================================
    // PHASE 4: UPLOAD TO SUPABASE
    // ============================================
    if (options.skipUpload) {
        log(ctx, "Phase 4: Skipping upload (skipUpload=true)");

        return {
            status: "success",
            run_id: runId,
            business_slug: ctx.businessSlug,
            html_size_bytes: Buffer.byteLength(htmlContent, "utf-8"),
            generated_at: new Date().toISOString(),
        };
    }

    log(ctx, "Phase 4: Uploading to Supabase Storage...");

    // Check bucket exists
    const bucketExists = await checkBucketExists();
    if (!bucketExists) {
        log(ctx, "Bucket check failed - attempting upload anyway", "error");
    }

    try {
        const uploadResult = await uploadWebsite(ctx.businessSlug, htmlContent, runId);

        if (!uploadResult.success) {
            log(ctx, `Upload failed: ${uploadResult.error}`, "error");

            return createErrorResult({
                run_id: runId,
                error_message: `Upload failed: ${uploadResult.error}`,
                error_phase: "upload",
            });
        }

        log(ctx, "Upload completed", "success");
        log(ctx, `Public URL: ${uploadResult.publicUrl}`);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n${"=".repeat(60)}`);
        console.log(`🎉 Pipeline Complete in ${elapsed}s`);
        console.log(`   Business: ${input.business_name}`);
        console.log(`   URL: ${uploadResult.publicUrl}`);
        console.log(`${"=".repeat(60)}\n`);

        return createSuccessResult({
            run_id: runId,
            business_slug: ctx.businessSlug,
            storage_path: uploadResult.storagePath!,
            public_url: uploadResult.publicUrl!,
            html_size_bytes: uploadResult.sizeBytes!,
        });
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        log(ctx, `Upload exception: ${errorMessage}`, "error");

        return createErrorResult({
            run_id: runId,
            error_message: `Upload exception: ${errorMessage}`,
            error_phase: "upload",
        });
    }
}
