#!/usr/bin/env node

/**
 * Purge Website Flow User
 *
 * ⚠️  DANGEROUS: Deletes all website data for a user.
 * Defaults to dry-run mode. Pass --execute to actually delete.
 *
 * Usage:
 *   npx ts-node scripts/purgeWebsiteFlowUser.ts \
 *     --owner-user-id "user-123" \
 *     [--site-id "specific-site-uuid"] \
 *     [--execute] \
 *     [--skip-payments] \
 *     [--dry-run]
 */

import minimist from "minimist";
import "dotenv/config";
import {
    getSitesByOwner,
    getSiteById,
    deleteUserSites,
    deleteSiteById,
    listBucketFiles,
    deleteFromBucket,
    BUCKET_PUBLISHED,
    BUCKET_SNAPSHOTS,
    BUCKET_ASSETS,
} from "../src/services/database.js";
import { slugify } from "../src/services/slugify.js";

const argv = minimist(process.argv.slice(2));

// ============================================
// Help
// ============================================
if (argv.help || argv.h) {
    console.log(`
🗑️  Purge Website Flow User

⚠️  DANGEROUS: Deletes all data for a user. Dry-run by default.

Usage:
  npx ts-node scripts/purgeWebsiteFlowUser.ts [options]

Required:
  --owner-user-id   Owner user ID

Optional:
  --site-id         Limit purge to a specific site
  --execute         Actually execute the purge (without this, it's dry-run)
  --skip-payments   Skip payment record cleanup
  --dry-run         Explicitly set dry-run mode (default)
  -h, --help        Show this help message
`);
    process.exit(0);
}

// ============================================
// Validate required args
// ============================================
const ownerUserId = argv["owner-user-id"] as string | undefined;
const siteId = argv["site-id"] as string | undefined;
const execute = !!argv["execute"];
const skipPayments = !!argv["skip-payments"];
const isDryRun = !execute;

if (!ownerUserId) {
    console.error("❌ Missing required flag: --owner-user-id");
    process.exit(1);
}

// ============================================
// Stub Functions
// ============================================
function cleanupDaytonaSandboxes(userId: string): void {
    console.log(`  🧹 Cleaning Daytona sandboxes for user ${userId}...`);
    // Stub: Daytona integration not implemented yet
    console.log("  ⏭️  Daytona cleanup: Stubbed (no-op)");
}

function cleanupPaymentRecords(userId: string): void {
    console.log(`  💳 Deleting subscription records for user ${userId}...`);
    // Stub: Payment table schema not finalized yet
    console.log("  ⏭️  Payment cleanup: Stubbed (no-op — schema pending)");
}

// ============================================
// Main
// ============================================
async function main() {
    console.log("\n🗑️  Purge Website Flow User");
    console.log("=".repeat(60));
    console.log(`  Owner:        ${ownerUserId}`);
    console.log(`  Scope:        ${siteId ? `Single site (${siteId})` : "ALL sites"}`);
    console.log(`  Mode:         ${isDryRun ? "🔍 DRY RUN (no changes)" : "🔴 EXECUTE (destructive)"}`);
    console.log(`  Skip Payments: ${skipPayments}`);
    console.log("=".repeat(60));

    // 1. Gather sites
    let sites;
    if (siteId) {
        const site = await getSiteById(siteId);
        if (!site) {
            console.error(`❌ Site not found: ${siteId}`);
            process.exit(1);
        }
        if (site.owner_user_id !== ownerUserId) {
            console.error(`❌ Site ${siteId} does not belong to owner ${ownerUserId}`);
            process.exit(1);
        }
        sites = [site];
    } else {
        sites = await getSitesByOwner(ownerUserId!);
    }

    if (sites.length === 0) {
        console.log("\n✅ No sites found for this user. Nothing to purge.");
        process.exit(0);
    }

    console.log(`\n📋 Found ${sites.length} site(s):`);
    for (const site of sites) {
        console.log(`  • ${site.id} — "${site.business_name}" (${site.city || "?"})`);
    }

    // 2. Gather storage files
    const allFilesToDelete: { bucket: string; paths: string[] }[] = [];
    const buckets = [BUCKET_PUBLISHED, BUCKET_SNAPSHOTS, BUCKET_ASSETS];

    for (const site of sites) {
        const slug = slugify(site.business_name);
        const prefix = `${slug}/${site.id}`;

        for (const bucket of buckets) {
            const files = await listBucketFiles(bucket, prefix);
            if (files.length > 0) {
                allFilesToDelete.push({ bucket, paths: files });
                console.log(`  📁 ${bucket}/${prefix}: ${files.length} file(s)`);
            }
        }
    }

    const totalFiles = allFilesToDelete.reduce((sum, b) => sum + b.paths.length, 0);

    // 3. Summary
    console.log("\n" + "-".repeat(60));
    console.log("📊 PURGE SUMMARY");
    console.log("-".repeat(60));
    console.log(`  Database rows:  ${sites.length} site(s) + associated revisions`);
    console.log(`  Storage files:  ${totalFiles} file(s) across ${allFilesToDelete.length} bucket(s)`);
    console.log(`  Daytona:        Will cleanup sandboxes`);
    console.log(`  Payments:       ${skipPayments ? "⏭️  Skipped" : "Will cleanup"}`);
    console.log("-".repeat(60));

    // 4. Execute or dry-run
    if (isDryRun) {
        console.log("\n🔍 DRY RUN — No changes made.");
        console.log("   To execute, re-run with --execute flag.");
        console.log("");
        process.exit(0);
    }

    // === DESTRUCTIVE ZONE ===
    console.log("\n🔴 EXECUTING PURGE...\n");

    // 4a. Delete storage files
    for (const { bucket, paths } of allFilesToDelete) {
        console.log(`  🗑️  Deleting ${paths.length} file(s) from ${bucket}...`);
        const result = await deleteFromBucket(bucket, paths);
        if (!result.success) {
            console.error(`  ⚠️  Error deleting from ${bucket}: ${result.error}`);
        } else {
            console.log(`  ✅ Deleted from ${bucket}`);
        }
    }

    // 4b. Delete database rows
    if (siteId) {
        console.log(`\n  🗑️  Deleting site ${siteId} and its revisions...`);
        const result = await deleteSiteById(siteId);
        if (!result.success) {
            console.error(`  ⚠️  Error: ${result.error}`);
        } else {
            console.log(`  ✅ Site deleted`);
        }
    } else {
        console.log(`\n  🗑️  Deleting all ${sites.length} site(s) for user ${ownerUserId}...`);
        const result = await deleteUserSites(ownerUserId!);
        if (!result.success) {
            console.error(`  ⚠️  Error: ${result.error}`);
        } else {
            console.log(`  ✅ Deleted ${result.deletedCount} site(s)`);
        }
    }

    // 4c. Cleanup Daytona sandboxes
    cleanupDaytonaSandboxes(ownerUserId!);

    // 4d. Cleanup payment records
    if (!skipPayments) {
        cleanupPaymentRecords(ownerUserId!);
    }

    console.log("\n" + "=".repeat(60));
    console.log("🎉 Purge complete!");
    console.log("=".repeat(60) + "\n");
}

main().catch((err) => {
    console.error("❌ Fatal error:", err);
    process.exit(1);
});
