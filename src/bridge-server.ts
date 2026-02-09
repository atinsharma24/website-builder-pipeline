import Fastify from "fastify";
import cors from "@fastify/cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directories for task files
const PENDING_DIR = path.join(__dirname, "../tasks/pending");
const COMPLETED_DIR = path.join(__dirname, "../tasks/completed");

// Ensure directories exist
[PENDING_DIR, COMPLETED_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

const server = Fastify({ logger: true });

// Enable CORS for n8n connections
await server.register(cors, {
    origin: true, // Allow all origins (tighten in production)
});

// --- Request/Response Types ---
interface GenerateRequest {
    prompt: string;
    userId: string;
}

interface GenerateResponse {
    status: "queued" | "error";
    taskId?: string;
    error?: string;
}

// --- POST /generate ---
// n8n sends technical prompts here, we queue them as task files
server.post<{ Body: GenerateRequest }>("/generate", async (request, reply) => {
    const { prompt, userId } = request.body;

    if (!prompt || !userId) {
        return reply.code(400).send({
            status: "error",
            error: "Both 'prompt' and 'userId' are required",
        } as GenerateResponse);
    }

    // Generate unique task ID: timestamp + short uuid
    const timestamp = Date.now();
    const shortId = uuidv4().split("-")[0];
    const taskId = `${timestamp}-${shortId}`;

    // Write task file with metadata header
    const taskContent = `---
taskId: ${taskId}
userId: ${userId}
createdAt: ${new Date().toISOString()}
---

${prompt}
`;

    const taskPath = path.join(PENDING_DIR, `task-${taskId}.md`);

    try {
        fs.writeFileSync(taskPath, taskContent, "utf-8");
        console.log(`📝 Task queued: ${taskId}`);

        return reply.send({
            status: "queued",
            taskId: taskId,
        } as GenerateResponse);
    } catch (error) {
        console.error("Failed to write task file:", error);
        return reply.code(500).send({
            status: "error",
            error: "Failed to queue task",
        } as GenerateResponse);
    }
});

// --- Health Check ---
server.get("/health", async () => {
    return { status: "ok", service: "bridge-server" };
});

// --- Start Server ---
const start = async () => {
    try {
        await server.listen({ port: 4000, host: "0.0.0.0" });
        console.log("🌉 Bridge Server listening on http://localhost:4000");
        console.log("📂 Pending tasks:", PENDING_DIR);
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();
