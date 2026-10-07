import chokidar from "chokidar";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { describeErrors, validateHtml } from "./quality/html-validator.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.join(__dirname, "../output");

// Ensure output directory exists
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ CRITICAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const BUCKET_NAME = "websites";

console.log("👀 Watcher Active: Waiting for HTML files in:", outputDir);

const watcher = chokidar.watch(outputDir, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    depth: 2,
    ignoreInitial: true
});

watcher.on("add", async (filePath) => {
    if (!filePath.endsWith("index.html")) return;

    console.log(`✨ New website detected: ${filePath}`);

    try {
        const fileContent = fs.readFileSync(filePath, "utf-8");

        // Hand built HTML goes through the same gate as generated HTML.
        const report = validateHtml(fileContent);
        if (!report.ok) {
            console.error(`❌ Not uploaded, HTML failed the quality gate:\n${describeErrors(report)}`);
            return;
        }
        const runId = path.basename(path.dirname(filePath)); // Get folder name (e.g. task-123)
        const uploadName = `${runId}.html`;

        // Upload
        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(uploadName, fileContent, {
                contentType: "text/html",
                upsert: true
            });

        if (error) throw error;

        const { data: urlData } = supabase.storage
            .from(BUCKET_NAME)
            .getPublicUrl(uploadName);

        console.log(`🚀 DEPLOYED TO SUPABASE:`);
        console.log(`🔗 ${urlData.publicUrl}`);

    } catch (err) {
        console.error("❌ Upload Failed:", err);
    }
});

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\n👋 Shutting down watcher...");
    watcher.close();
    process.exit(0);
});
