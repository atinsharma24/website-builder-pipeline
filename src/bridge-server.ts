import Fastify from "fastify";
import cors from "@fastify/cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runArchitect } from "./agents.js";
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

fastify.post("/generate", async (request, reply) => {
    const { prompt, userId } = request.body as { prompt: string; userId: string };

    try {
        const runId = `task-${Date.now()}`;

        // 1. Call GEMINI (The Architect) - This uses the API Key
        console.log(`[${runId}] Consulting The Architect (Gemini)...`);
        const architectSpec = await runArchitect(prompt);

        // 2. Create Instructions for Antigravity Agent (You!)
        const agentInstructions = `
# WEBSITE GENERATION TASK
**ID:** ${runId}

## USER REQUEST
"${prompt}"

## TECHNICAL ARCHITECTURE
${architectSpec}

## YOUR JOB (Antigravity Agent)
1. Read the requirements above.
2. Generate a single 'index.html' file using Tailwind CSS.
3. Save it EXACTLY to: output/${runId}/index.html
`;

        // 3. Save to "tasks" folder
        const taskFilePath = path.join(tasksDir, `${runId}.md`);
        fs.writeFileSync(taskFilePath, agentInstructions);

        console.log(`[${runId}] Spec saved to ${taskFilePath}. Waiting for Agent...`);

        return {
            status: "processing",
            message: "Architect phase complete. Task sent to Local Agent.",
            runId
        };

    } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ error: "Architecture Phase Failed" });
    }
});

const start = async () => {
    try {
        await fastify.listen({ port: 4000 });
        console.log("🌉 Hybrid Bridge Server listening on port 4000");
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
