import Fastify from "fastify";
import cors from "@fastify/cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "./pipeline/index.js";
import { BusinessInputSchema } from "./schemas/index.js";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({ logger: true });
await fastify.register(cors);

// Ensure output directory exists for local file saves
const outputDir = path.join(__dirname, "../output");
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

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
        console.log("  POST /pipeline   - Run full website generation pipeline");
        console.log("  POST /validate   - Validate business input");
        console.log("  GET  /health     - Health check");
        console.log("\nQuery params for /pipeline:");
        console.log("  ?mock=true       - Use mock agents (no LLM calls)");
        console.log("  ?skipUpload=true - Skip Supabase upload");
        console.log("=".repeat(60) + "\n");

    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
