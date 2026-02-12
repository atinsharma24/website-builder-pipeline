#!/usr/bin/env node

/**
 * Override Website Builder HTML
 *
 * Force-update HTML for a specific site. Can target the published version,
 * create a snapshot revision, or both.
 *
 * Usage:
 *   npx ts-node scripts/overrideWebsiteBuilderHtml.ts \
 *     --owner-user-id "user-123" \
 *     --site-id "site-uuid" \
 *     --target published \
 *     --html-file ./output/acme/index.html
 */

import minimist from "minimist";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import {
    getSiteById,
    upsertSite,
    createRevision,
    uploadToBucket,
    BUCKET_PUBLISHED,
    BUCKET_SNAPSHOTS,
} from "../src/services/database.js";
import { slugify } from "../src/services/slugify.js";

const argv = minimist(process.argv.slice(2));

// ============================================
// Help
// ============================================
if (argv.help || argv.h) {
    console.log(`
🔄 Override Website Builder HTML

Usage:
  npx ts-node scripts/overrideWebsiteBuilderHtml.ts [options]

Required:
  --owner-user-id   Owner user ID
  --site-id         Site ID to override
  --target          Target: 'published' | 'snapshot' | 'both'
  --html-file       Path to the HTML file
    OR
  --html-base64     Base64-encoded HTML string

Optional:
  -h, --help        Show this help message
`);
    process.exit(0);
}

// ============================================
// Validate required args
// ============================================
const ownerUserId = argv["owner-user-id"] as string | undefined;
const siteId = argv["site-id"] as string | undefined;
const target = (argv["target"] as string | undefined) || "published";
const htmlFile = argv["html-file"] as string | undefined;
const htmlBase64 = argv["html-base64"] as string | undefined;

if (!ownerUserId) {
    console.error("❌ Missing required flag: --owner-user-id");
    process.exit(1);
}
if (!siteId) {
    console.error("❌ Missing required flag: --site-id");
    process.exit(1);
}
if (!["published", "snapshot", "both"].includes(target)) {
    console.error("❌ --target must be 'published', 'snapshot', or 'both'");
    process.exit(1);
}
if (!htmlFile && !htmlBase64) {
    console.error("❌ Must provide either --html-file or --html-base64");
    process.exit(1);
}

// ============================================
// Read HTML content
// ============================================
let htmlContent: string;

if (htmlFile) {
    const resolvedPath = path.resolve(htmlFile);
    if (!fs.existsSync(resolvedPath)) {
        console.error(`❌ HTML file not found: ${resolvedPath}`);
        process.exit(1);
    }
    htmlContent = fs.readFileSync(resolvedPath, "utf-8");
    console.log(`📄 Read HTML from file: ${resolvedPath} (${htmlContent.length} chars)`);
} else {
    htmlContent = Buffer.from(htmlBase64!, "base64").toString("utf-8");
    console.log(`📄 Decoded HTML from base64 (${htmlContent.length} chars)`);
}

// ============================================
// Main
// ============================================
async function main() {
    console.log("\n🔄 Override Website Builder HTML");
    console.log("=".repeat(50));
    console.log(`  Owner:   ${ownerUserId}`);
    console.log(`  Site ID: ${siteId}`);
    console.log(`  Target:  ${target}`);
    console.log("=".repeat(50));

    // 1. Verify the site exists and belongs to the owner
    console.log("\n🔍 Verifying site ownership...");
    const site = await getSiteById(siteId!);

    if (!site) {
        console.error(`❌ Site not found: ${siteId}`);
        process.exit(1);
    }

    if (site.owner_user_id !== ownerUserId) {
        console.error(`❌ Site ${siteId} does not belong to owner ${ownerUserId}`);
        process.exit(1);
    }

    console.log(`✅ Site verified: "${site.business_name}"`);

    const slug = slugify(site.business_name);

    // 2. Handle 'published' or 'both'
    if (target === "published" || target === "both") {
        console.log("\n📝 Updating published HTML in database...");
        const updateResult = await upsertSite({
            ...site,
            html_content: htmlContent,
        });

        if (!updateResult.success) {
            console.error(`❌ Database update error: ${updateResult.error}`);
            process.exit(1);
        }
        console.log("✅ Database record updated");

        // Upload to published bucket
        const storagePath = `${slug}/${siteId}/index.html`;
        console.log(`📤 Uploading to ${BUCKET_PUBLISHED}/${storagePath}...`);
        const uploadResult = await uploadToBucket(BUCKET_PUBLISHED, storagePath, htmlContent);

        if (!uploadResult.success) {
            console.error(`❌ Published upload error: ${uploadResult.error}`);
        } else {
            console.log(`✅ Published upload: ${uploadResult.publicUrl}`);
        }
    }

    // 3. Handle 'snapshot' or 'both'
    if (target === "snapshot" || target === "both") {
        console.log("\n📸 Creating revision snapshot...");
        const revResult = await createRevision(siteId!, htmlContent, "override");

        if (!revResult.success) {
            console.error(`❌ Revision creation error: ${revResult.error}`);
        } else {
            console.log(`✅ Revision created (ID: ${revResult.revision?.id})`);
        }

        // Upload to snapshots bucket
        const timestamp = Date.now();
        const snapshotPath = `${slug}/${siteId}/snapshot-${timestamp}.html`;
        console.log(`📤 Uploading to ${BUCKET_SNAPSHOTS}/${snapshotPath}...`);
        const snapshotUpload = await uploadToBucket(BUCKET_SNAPSHOTS, snapshotPath, htmlContent);

        if (!snapshotUpload.success) {
            console.error(`❌ Snapshot upload error: ${snapshotUpload.error}`);
        } else {
            console.log(`✅ Snapshot upload: ${snapshotUpload.publicUrl}`);
        }
    }

    console.log("\n" + "=".repeat(50));
    console.log("🎉 Override complete!");
    console.log("=".repeat(50) + "\n");
}

main().catch((err) => {
    console.error("❌ Fatal error:", err);
    process.exit(1);
});
