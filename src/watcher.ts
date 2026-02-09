import chokidar from "chokidar";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { runBuilder } from "./agents.js";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directories
const PENDING_DIR = path.join(__dirname, "../tasks/pending");
const COMPLETED_DIR = path.join(__dirname, "../tasks/completed");
const OUTPUT_DIR = path.join(__dirname, "../output");

// Ensure directories exist
[PENDING_DIR, COMPLETED_DIR, OUTPUT_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Initialize Supabase client (using Service Role Key for storage uploads)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("❌ CRITICAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env");
    process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
    console.error("❌ CRITICAL: GEMINI_API_KEY is required in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Extract task ID from filename (e.g., "task-1234567890-abc123.md" -> "1234567890-abc123")
function extractTaskId(filename: string): string {
    return filename.replace("task-", "").replace(".md", "");
}

// Parse task file to extract prompt (skip frontmatter)
function parseTaskFile(content: string): string {
    const lines = content.split("\n");
    let inFrontmatter = false;
    let promptLines: string[] = [];

    for (const line of lines) {
        if (line.trim() === "---") {
            inFrontmatter = !inFrontmatter;
            continue;
        }
        if (!inFrontmatter) {
            promptLines.push(line);
        }
    }

    return promptLines.join("\n").trim();
}

// Process a single task file
async function processTask(filePath: string): Promise<void> {
    const filename = path.basename(filePath);
    const taskId = extractTaskId(filename);

    console.log(`\n🔧 Processing task: ${taskId}`);

    try {
        // 1. Read task file
        const content = fs.readFileSync(filePath, "utf-8");
        const prompt = parseTaskFile(content);

        if (!prompt) {
            console.error(`❌ Empty prompt in task: ${taskId}`);
            return;
        }

        console.log(`📖 Prompt loaded (${prompt.length} chars)`);

        // 2. Generate HTML with Builder Agent
        console.log(`⚙️ Generating HTML...`);
        const html = await runBuilder(prompt);

        // 3. Save locally
        const outputFilename = `site-${taskId}.html`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        fs.writeFileSync(outputPath, html, "utf-8");
        console.log(`💾 Saved locally: ${outputPath}`);

        // 4. Upload to Supabase Storage
        console.log(`☁️ Uploading to Supabase...`);
        const { data, error } = await supabase.storage
            .from("websites")
            .upload(outputFilename, html, {
                contentType: "text/html",
                upsert: true,
            });

        if (error) {
            console.error(`❌ Supabase upload failed:`, error.message);
        } else {
            // Get public URL
            const { data: urlData } = supabase.storage
                .from("websites")
                .getPublicUrl(outputFilename);

            console.log(`✅ Site Deployed: ${urlData.publicUrl}`);
        }

        // 5. Move task to completed
        const completedPath = path.join(COMPLETED_DIR, filename);
        fs.renameSync(filePath, completedPath);
        console.log(`📁 Task moved to completed/`);

    } catch (error) {
        console.error(`❌ Failed to process task ${taskId}:`, error);
    }
}

// --- Main Watcher ---
console.log("👀 Watcher started. Monitoring:", PENDING_DIR);
console.log("Press Ctrl+C to stop.\n");

// Process any existing files first
const existingFiles = fs.readdirSync(PENDING_DIR).filter((f) => f.endsWith(".md"));
for (const file of existingFiles) {
    await processTask(path.join(PENDING_DIR, file));
}

// Watch for new files
const watcher = chokidar.watch(PENDING_DIR, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
    },
});

watcher.on("add", async (filePath) => {
    if (filePath.endsWith(".md")) {
        await processTask(filePath);
    }
});

watcher.on("error", (error) => {
    console.error("Watcher error:", error);
});

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\n👋 Shutting down watcher...");
    watcher.close();
    process.exit(0);
});
