#!/usr/bin/env node

/**
 * Import Website Builder Published HTML
 *
 * Creates a new site record or updates an existing one, then uploads
 * the HTML to the wb-site-published bucket.
 *
 * Usage:
 *   npx ts-node scripts/importWebsiteBuilderPublishedHtml.ts \
 *     --owner-user-id "user-123" \
 *     --business-name "Acme Corp" \
 *     --category "retail" \
 *     --tagline "Quality you can trust" \
 *     --city "Mumbai" \
 *     --state "Maharashtra" \
 *     --phone "+91-9876543210" \
 *     --html-file ./output/acme/index.html \
 *     [--site-id "existing-uuid"] \
 *     [--overwrite]
 */

import minimist from "minimist";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import {
    upsertSite,
    uploadToBucket,
    BUCKET_PUBLISHED,
} from "../src/services/database.js";
import { slugify } from "../src/services/slugify.js";

const argv = minimist(process.argv.slice(2));

// ============================================
// Help
// ============================================
if (argv.help || argv.h) {
    console.log(`
📦 Import Website Builder Published HTML

Usage:
  npx ts-node scripts/importWebsiteBuilderPublishedHtml.ts [options]

Required:
  --owner-user-id   Owner user ID
  --business-name   Business name
  --html-file       Path to the HTML file
    OR
  --html-base64     Base64-encoded HTML string

Optional:
  --category        Business category
  --tagline         Business tagline
  --city            City
  --state           State
  --phone           Phone number
  --site-id         Existing site ID (for updates)
  --overwrite       Allow overwriting existing site (requires --site-id)
  -h, --help        Show this help message
`);
    process.exit(0);
}

// ============================================
// Validate required args
// ============================================
const ownerUserId = argv["owner-user-id"] as string | undefined;
const businessName = argv["business-name"] as string | undefined;
const htmlFile = argv["html-file"] as string | undefined;
const htmlBase64 = argv["html-base64"] as string | undefined;
const siteId = argv["site-id"] as string | undefined;
const overwrite = !!argv["overwrite"];

if (!ownerUserId) {
    console.error("❌ Missing required flag: --owner-user-id");
    process.exit(1);
}
if (!businessName) {
    console.error("❌ Missing required flag: --business-name");
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
    console.log("\n🚀 Import Website Builder Published HTML");
    console.log("=".repeat(50));
    console.log(`  Owner:    ${ownerUserId}`);
    console.log(`  Business: ${businessName}`);
    console.log(`  Site ID:  ${siteId || "(new)"}`);
    console.log(`  Overwrite: ${overwrite}`);
    console.log("=".repeat(50));

    // 1. Upsert the site record
    if (siteId && !overwrite) {
        console.error("⚠️  --site-id provided but --overwrite not set. Use --overwrite to update.");
        process.exit(1);
    }

    const siteData = {
        ...(siteId ? { id: siteId } : {}),
        owner_user_id: ownerUserId!,
        business_name: businessName!,
        category: argv["category"] as string | undefined,
        tagline: argv["tagline"] as string | undefined,
        city: argv["city"] as string | undefined,
        state: argv["state"] as string | undefined,
        phone: argv["phone"] as string | undefined,
        is_published: true,
        html_content: htmlContent,
    };

    console.log("\n📝 Upserting site record...");
    const result = await upsertSite(siteData);

    if (!result.success) {
        console.error(`❌ Database error: ${result.error}`);
        process.exit(1);
    }

    const savedSiteId = result.site?.id;
    console.log(`✅ Site record saved (ID: ${savedSiteId})`);

    // 2. Upload HTML to storage bucket
    const slug = slugify(businessName!);
    const storagePath = `${slug}/${savedSiteId}/index.html`;

    console.log(`\n📤 Uploading to ${BUCKET_PUBLISHED}/${storagePath}...`);
    const uploadResult = await uploadToBucket(BUCKET_PUBLISHED, storagePath, htmlContent);

    if (!uploadResult.success) {
        console.error(`❌ Upload error: ${uploadResult.error}`);
        process.exit(1);
    }

    console.log(`✅ Upload successful!`);
    console.log(`🌍 Public URL: ${uploadResult.publicUrl}`);

    console.log("\n" + "=".repeat(50));
    console.log("🎉 Import complete!");
    console.log(`   Site ID:    ${savedSiteId}`);
    console.log(`   Public URL: ${uploadResult.publicUrl}`);
    console.log("=".repeat(50) + "\n");
}

main().catch((err) => {
    console.error("❌ Fatal error:", err);
    process.exit(1);
});
