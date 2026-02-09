import Fastify from "fastify";
import cors from "@fastify/cors";
// @ts-ignore - types may be in devDependencies
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runArchitect } from "./agents.js";
import { CATEGORY_DESIGNS } from "./types.js";
import type { BusinessInput, GenerateResponse } from "./types.js";
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

// --- Input Validation ---
function validateBusinessInput(data: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const input = data as Record<string, unknown>;

    const required = ["business_name", "address", "city", "state", "owner_name", "business_category", "description"];

    for (const field of required) {
        if (!input[field] || (typeof input[field] === "string" && input[field].trim() === "")) {
            errors.push(`Missing required field: ${field}`);
        }
    }

    if (input.business_category && !CATEGORY_DESIGNS[input.business_category as keyof typeof CATEGORY_DESIGNS]) {
        errors.push(`Invalid business_category. Valid options: ${Object.keys(CATEGORY_DESIGNS).join(", ")}`);
    }

    if (input.photos && !Array.isArray(input.photos)) {
        errors.push("photos must be an array of strings");
    }

    return { valid: errors.length === 0, errors };
}

// --- Main Generation Endpoint ---
fastify.post<{ Body: BusinessInput; Reply: GenerateResponse }>("/generate", async (request, reply) => {
    const businessData = request.body;

    // Validate input
    const validation = validateBusinessInput(businessData);
    if (!validation.valid) {
        return reply.code(400).send({
            status: "error",
            message: `Validation failed: ${validation.errors.join("; ")}`,
            runId: ""
        });
    }

    try {
        const runId = `task-${Date.now()}`;

        // 1. Call GEMINI (The Architect) - Generate comprehensive specification
        console.log(`[${runId}] 🏛️  Consulting The Architect (Gemini)...`);
        console.log(`[${runId}] 📋 Business: ${businessData.business_name} (${businessData.business_category})`);

        const architectSpec = await runArchitect(businessData);

        // 2. Create Instructions for Antigravity Agent (You!)
        const agentInstructions = `
# WEBSITE GENERATION TASK
**ID:** ${runId}
**Generated:** ${new Date().toISOString()}

---

## BUSINESS INFORMATION

| Field | Value |
|-------|-------|
| **Name** | ${businessData.business_name} |
| **Owner** | ${businessData.owner_name} |
| **Category** | ${businessData.business_category} |
| **Address** | ${businessData.address}, ${businessData.city}, ${businessData.state} |
${businessData.phone ? `| **Phone** | ${businessData.phone} |` : ""}
${businessData.email ? `| **Email** | ${businessData.email} |` : ""}
${businessData.whatsapp ? `| **WhatsApp** | ${businessData.whatsapp} |` : ""}

### Description
${businessData.description}

### Photos
${businessData.photos && businessData.photos.length > 0
                ? businessData.photos.map((url, i) => `${i + 1}. ${url}`).join("\n")
                : "No photos provided - use appropriate placeholder images"}

---

## TECHNICAL ARCHITECTURE (From Architect Agent)

${architectSpec}

---

## YOUR JOB (Antigravity Agent)

### Output Requirements
1. Generate a **SINGLE, SELF-CONTAINED** \`index.html\` file
2. Use **Tailwind CSS via CDN** (\`<script src="https://cdn.tailwindcss.com"></script>\`)
3. Include **ALL CSS inline** (embedded \`<style>\` blocks for custom styles)
4. Include **ALL JavaScript inline** (embedded \`<script>\` blocks)
5. Make the design **VISUALLY STUNNING** - this is a premium, professional website

### Technical Standards
- Mobile-first responsive design
- Smooth scroll behavior
- Lazy loading for images
- WCAG AA accessibility compliance
- Fast loading performance

### Save Location
\`\`\`
output/${runId}/index.html
\`\`\`

### Quality Checklist
- [ ] All sections from the specification are implemented
- [ ] Color scheme matches the specification
- [ ] Typography uses specified Google Fonts
- [ ] Mobile layout is fully responsive
- [ ] All interactive elements have hover states
- [ ] Contact information is correctly displayed
- [ ] WhatsApp/Contact CTA is floating and visible
`;

        // 3. Save to "tasks" folder
        const taskFilePath = path.join(tasksDir, `${runId}.md`);
        fs.writeFileSync(taskFilePath, agentInstructions);

        console.log(`[${runId}] ✅ Specification saved to ${taskFilePath}`);
        console.log(`[${runId}] 👀 Waiting for Antigravity Agent to generate website...`);

        return {
            status: "processing",
            message: `Architect phase complete for ${businessData.business_name}. Task sent to Local Agent.`,
            runId,
            taskFilePath
        };

    } catch (error) {
        request.log.error(error);
        return reply.code(500).send({
            status: "error",
            message: "Architecture Phase Failed",
            runId: ""
        });
    }
});

// --- Health Check Endpoint ---
fastify.get("/health", async () => {
    return {
        status: "healthy",
        service: "website-pipeline-bridge",
        timestamp: new Date().toISOString()
    };
});

// --- List Supported Categories ---
fastify.get("/categories", async () => {
    return {
        categories: Object.keys(CATEGORY_DESIGNS),
        details: Object.entries(CATEGORY_DESIGNS).map(([key, config]) => ({
            id: key,
            name: key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
            designPhilosophy: config.designPhilosophy,
            primaryColor: config.primaryColor
        }))
    };
});

// --- Server Startup ---
const start = async () => {
    try {
        const port = parseInt(process.env.PORT || "4000");
        await fastify.listen({ port, host: "0.0.0.0" });
        console.log("═══════════════════════════════════════════════════════════");
        console.log("🌉 HYBRID BRIDGE SERVER");
        console.log("═══════════════════════════════════════════════════════════");
        console.log(`📡 Listening on http://localhost:${port}`);
        console.log("");
        console.log("Endpoints:");
        console.log(`  POST /generate  - Generate website from business data`);
        console.log(`  GET  /health    - Health check`);
        console.log(`  GET  /categories - List supported business categories`);
        console.log("═══════════════════════════════════════════════════════════");
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
