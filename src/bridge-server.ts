import Fastify from "fastify";
import cors from "@fastify/cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runArchitect, type BusinessInput } from "./agents.js";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({ logger: true });
await fastify.register(cors);

// Ensure directories exist
const tasksDir = path.join(__dirname, "../tasks");
const outputDir = path.join(__dirname, "../output");
if (!fs.existsSync(tasksDir)) fs.mkdirSync(tasksDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// --- POST /generate ---
// Accepts structured business input, calls Architect, saves task for Agent
fastify.post("/generate", async (request, reply) => {
    const input = request.body as BusinessInput;

    // Validate required fields
    if (!input.businessName || !input.category) {
        return reply.code(400).send({
            error: "Missing required fields",
            required: ["businessName", "category"],
            received: Object.keys(input),
        });
    }

    // Set defaults for optional fields
    const normalizedInput: BusinessInput = {
        businessName: input.businessName,
        ownerName: input.ownerName || "The Owner",
        category: input.category,
        address: input.address || "",
        city: input.city || "",
        state: input.state || "",
        description: input.description || `A professional ${input.category} business.`,
        photos: input.photos || [],
    };

    try {
        const runId = `task-${Date.now()}`;

        // 1. Call GEMINI (The Architect Agent)
        console.log(`[${runId}] 🏛️ Consulting The Architect (Gemini)...`);
        const architectSpec = await runArchitect(normalizedInput);
        console.log(`[${runId}] ✅ Architecture complete (${architectSpec.length} chars)`);

        // 2. Create Instructions for Antigravity Agent (Website Builder)
        const location = [normalizedInput.address, normalizedInput.city, normalizedInput.state]
            .filter(Boolean)
            .join(", ");

        const agentInstructions = `
# 🌐 WEBSITE GENERATION TASK
**ID:** ${runId}

---

## 📋 BUSINESS DETAILS
| Field | Value |
|-------|-------|
| **Name** | ${normalizedInput.businessName} |
| **Owner** | ${normalizedInput.ownerName} |
| **Category** | ${normalizedInput.category} |
| **Location** | ${location || "Not specified"} |

## 📝 DESCRIPTION
${normalizedInput.description}

## 📸 PHOTOS
${normalizedInput.photos.length > 0
                ? normalizedInput.photos.map((url, i) => `${i + 1}. ${url}`).join('\n')
                : "No photos provided - use high-quality Unsplash placeholders"}

---

## 🎨 TECHNICAL ARCHITECTURE (From Architect Agent)
${architectSpec}

---

## 🎯 YOUR JOB (Antigravity Agent)
1. Read the architecture specification above carefully
2. Generate a single, stunning \`index.html\` file using Tailwind CSS
3. Include AOS animations for scroll effects
4. Save it EXACTLY to: \`output/${runId}/index.html\`

**The website should be SO beautiful that the business owner is AMAZED!**
`;

        // 3. Save to "tasks" folder
        const taskFilePath = path.join(tasksDir, `${runId}.md`);
        fs.writeFileSync(taskFilePath, agentInstructions);

        console.log(`[${runId}] 📁 Task saved: ${taskFilePath}`);
        console.log(`[${runId}] ⏳ Waiting for Agent to generate website...`);

        return {
            status: "processing",
            message: "Architect phase complete. Task sent to Website Builder Agent.",
            runId,
            taskFile: `tasks/${runId}.md`,
            expectedOutput: `output/${runId}/index.html`,
        };

    } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ error: "Architecture Phase Failed" });
    }
});

// --- Health Check ---
fastify.get("/health", async () => {
    return {
        status: "ok",
        service: "website-pipeline-bridge",
        timestamp: new Date().toISOString()
    };
});

// --- Start Server ---
const start = async () => {
    // Check for required env vars
    if (!process.env.GEMINI_API_KEY) {
        console.error("❌ CRITICAL: GEMINI_API_KEY is missing from .env");
        process.exit(1);
    }

    try {
        await fastify.listen({ port: 4000, host: "0.0.0.0" });
        console.log("🌉 Hybrid Bridge Server listening on http://localhost:4000");
        console.log("📂 Tasks directory:", tasksDir);
        console.log("📂 Output directory:", outputDir);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
