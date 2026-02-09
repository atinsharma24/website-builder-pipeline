import Fastify from "fastify";
import cors from "@fastify/cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "./pipeline/index.js";
import { BusinessInputSchema } from "./schemas/index.js";
import { runArchitect, mockArchitect } from "./agents/index.js";
import { slugify, generateRunId, uploadWebsite } from "./services/index.js";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({ logger: true });
await fastify.register(cors);

// Ensure directories exist
const outputDir = path.join(__dirname, "../output");
const tasksDir = path.join(__dirname, "../tasks");
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
if (!fs.existsSync(tasksDir)) fs.mkdirSync(tasksDir, { recursive: true });

// ============================================
// POST /pipeline - Main Pipeline Endpoint
// ============================================
// Accepts structured business input and runs the complete pipeline
fastify.post("/pipeline", async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    // Check for mock mode query param
    const useMock = (request.query as Record<string, string>).mock === "true";
    const skipUpload = (request.query as Record<string, string>).skipUpload === "true";

    try {
        console.log(`\n🌐 Received pipeline request (mock=${useMock}, skipUpload=${skipUpload})`);

        const result = await runPipeline(body, {
            useMock,
            skipUpload,
            outputDir, // Save locally as backup
        });

        if (result.status === "error") {
            return reply.code(400).send(result);
        }

        return result;
    } catch (error) {
        request.log.error(error);
        return reply.code(500).send({
            status: "error",
            error_message: "Internal pipeline error",
            error_phase: "unknown",
        });
    }
});

// ============================================
// POST /validate - Validate Input Only
// ============================================
// Validates business input without running the pipeline
fastify.post("/validate", async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    const validation = BusinessInputSchema.safeParse(body);

    if (!validation.success) {
        return reply.code(400).send({
            valid: false,
            errors: validation.error.issues.map((e) => ({
                field: e.path.join("."),
                message: e.message,
            })),
        });
    }

    return {
        valid: true,
        data: validation.data,
    };
});

// ============================================
// POST /architect - Antigravity Workflow (Step 1)
// ============================================
// Runs only the Architect Agent and saves a task file for Antigravity to pick up
fastify.post("/architect", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const useMock = (request.query as Record<string, string>).mock === "true";

    // Validate input
    const validation = BusinessInputSchema.safeParse(body);
    if (!validation.success) {
        return reply.code(400).send({
            status: "error",
            errors: validation.error.issues.map((e) => ({
                field: e.path.join("."),
                message: e.message,
            })),
        });
    }

    const input = validation.data;
    const runId = generateRunId();
    const businessSlug = slugify(input.business_name);

    console.log(`\n🏗️  Architect Request: ${input.business_name} (${runId}) [Mock: ${useMock}]`);

    try {
        let architectOutput;

        if (useMock) {
            console.log("🎭 Using MOCK Architect Agent...");
            // Simulate delay
            await new Promise(resolve => setTimeout(resolve, 1000));
            architectOutput = mockArchitect(input);
        } else {
            // Run the Architect Agent (Gemini LLM)
            console.log("📋 Calling Gemini Architect Agent...");
            architectOutput = await runArchitect(input);
        }

        console.log("✅ Architect completed");

        // Create the task directory for output
        const taskOutputDir = path.join(outputDir, businessSlug, runId);
        fs.mkdirSync(taskOutputDir, { recursive: true });

        // Save the task file as markdown for Antigravity to read
        const taskContent = `# Website Generation Task

## Run ID: ${runId}
## Business: ${input.business_name}
## Slug: ${businessSlug}

---

## OUTPUT LOCATION
Save your generated \`index.html\` to:
\`\`\`
output/${businessSlug}/${runId}/index.html
\`\`\`

---

## ARCHITECT PROMPT (Use this to generate the website)

${architectOutput.website_generation_prompt}

---

## STYLE GUIDELINES
${architectOutput.site_style_guidelines ? JSON.stringify(architectOutput.site_style_guidelines, null, 2) : "Use your best judgment for colors and fonts."}

---

## REQUIRED SECTIONS
${architectOutput.page_sections ? architectOutput.page_sections.map((s: any) => `- **${s.section_name}** (${s.section_id}): ${s.copy_hints || ""}`).join("\n") : "Standard business sections"}

---

## AFTER GENERATING

1. Save the HTML file to the output location above
2. Call: \`curl -X POST "http://localhost:4000/upload?runId=${runId}&slug=${businessSlug}"\`
   OR just wait - the watcher will auto-upload when it detects the file.
`;

        const taskFilePath = path.join(tasksDir, `${runId}.md`);
        fs.writeFileSync(taskFilePath, taskContent);

        // Also save raw architect output as JSON
        const specFilePath = path.join(taskOutputDir, "architect-spec.json");
        fs.writeFileSync(specFilePath, JSON.stringify(architectOutput, null, 2));

        console.log(`📁 Task saved: ${taskFilePath}`);
        console.log(`📁 Spec saved: ${specFilePath}`);
        console.log(`\n🔔 NEXT: Open the task file and generate index.html`);

        return {
            status: "pending_builder",
            run_id: runId,
            business_slug: businessSlug,
            task_file: `tasks/${runId}.md`,
            output_path: `output/${businessSlug}/${runId}/index.html`,
            spec_file: `output/${businessSlug}/${runId}/architect-spec.json`,
            next_step: "Generate index.html using the architect prompt, then call POST /upload or let watcher auto-upload",
        };
    } catch (error) {
        request.log.error(error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return reply.code(500).send({
            status: "error",
            error_message: `Architect failed: ${errorMessage}`,
        });
    }
});

// ============================================
// POST /upload - Upload existing HTML (Step 2)
// ============================================
// Manually trigger upload of a generated HTML file
fastify.post("/upload", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const runId = query.runId;
    const slug = query.slug;

    if (!runId || !slug) {
        return reply.code(400).send({
            status: "error",
            error_message: "Missing required query params: runId and slug",
        });
    }

    const htmlPath = path.join(outputDir, slug, runId, "index.html");

    if (!fs.existsSync(htmlPath)) {
        return reply.code(404).send({
            status: "error",
            error_message: `HTML file not found: ${htmlPath}`,
            expected_path: `output/${slug}/${runId}/index.html`,
        });
    }

    console.log(`\n📤 Manual upload triggered: ${htmlPath}`);

    try {
        const htmlContent = fs.readFileSync(htmlPath, "utf-8");
        const result = await uploadWebsite(slug, htmlContent, runId);

        if (!result.success) {
            return reply.code(500).send({
                status: "error",
                error_message: result.error,
            });
        }

        return {
            status: "success",
            run_id: runId,
            business_slug: slug,
            public_url: result.publicUrl,
            storage_path: result.storagePath,
            html_size_bytes: result.sizeBytes,
        };
    } catch (error) {
        request.log.error(error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return reply.code(500).send({
            status: "error",
            error_message: `Upload failed: ${errorMessage}`,
        });
    }
});

// ============================================
// GET /health - Health Check
// ============================================
fastify.get("/health", async () => {
    return {
        status: "healthy",
        timestamp: new Date().toISOString(),
        env: {
            gemini_configured: !!process.env.GEMINI_API_KEY,
            supabase_configured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
        },
    };
});

// ============================================
// Start Server
// ============================================
const start = async () => {
    try {
        const port = parseInt(process.env.PORT || "4000", 10);
        await fastify.listen({ port, host: "0.0.0.0" });

        console.log("\n" + "=".repeat(60));
        console.log("🚀 Website Pipeline API Server");
        console.log("=".repeat(60));
        console.log(`   Port: ${port}`);
        console.log(`   Gemini API: ${process.env.GEMINI_API_KEY ? "✅ Configured" : "❌ Missing"}`);
        console.log(`   Supabase: ${process.env.SUPABASE_URL ? "✅ Configured" : "❌ Missing"}`);
        console.log("=".repeat(60));
        console.log("\nEndpoints:");
        console.log("  POST /pipeline   - Full automated pipeline (Gemini builds)");
        console.log("  POST /architect  - Architect only → saves task for Antigravity");
        console.log("  POST /upload     - Upload HTML to Supabase (?runId=X&slug=Y)");
        console.log("  POST /validate   - Validate business input");
        console.log("  GET  /health     - Health check");
        console.log("\nAntigravity Workflow:");
        console.log("  1. POST /architect → generates task file");
        console.log("  2. Antigravity reads task, generates index.html");
        console.log("  3. Watcher auto-uploads OR call POST /upload");
        console.log("=".repeat(60) + "\n");

    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();

