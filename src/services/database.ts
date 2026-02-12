import { supabase } from "./supabase.js";
import "dotenv/config";

// ============================================
// Bucket Names
// ============================================
export const BUCKET_PUBLISHED = "wb-site-published";
export const BUCKET_SNAPSHOTS = "wb-site-snapshots";
export const BUCKET_ASSETS = "wb-site-assets";

// ============================================
// TypeScript Interfaces
// ============================================

export interface WebsiteBuilderSite {
    id?: string;
    owner_user_id: string;
    business_name: string;
    category?: string;
    tagline?: string;
    city?: string;
    state?: string;
    phone?: string;
    is_published?: boolean;
    html_content?: string;
    created_at?: string;
    updated_at?: string;
}

export interface WebsiteBuilderRevision {
    id?: string;
    site_id: string;
    html_content: string;
    snapshot_type: string; // 'manual' | 'auto' | 'override'
    created_at?: string;
}

// ============================================
// Helper: Ensure Supabase client is available
// ============================================
function ensureClient() {
    if (!supabase) {
        throw new Error(
            "❌ Supabase client not initialized. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
        );
    }
    return supabase;
}

// ============================================
// Database Operations
// ============================================

/**
 * Upsert (create or update) a site record in website_builder_sites.
 * If `data.id` is provided and exists, updates that row.
 * Otherwise, inserts a new row.
 */
export async function upsertSite(
    data: WebsiteBuilderSite
): Promise<{ success: boolean; site?: WebsiteBuilderSite; error?: string }> {
    const client = ensureClient();

    const payload: Record<string, unknown> = {
        owner_user_id: data.owner_user_id,
        business_name: data.business_name,
        category: data.category ?? null,
        tagline: data.tagline ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        phone: data.phone ?? null,
        is_published: data.is_published ?? false,
        html_content: data.html_content ?? null,
        updated_at: new Date().toISOString(),
    };

    if (data.id) {
        // Update existing
        const { data: updated, error } = await client
            .from("website_builder_sites")
            .update(payload)
            .eq("id", data.id)
            .select()
            .single();

        if (error) return { success: false, error: error.message };
        return { success: true, site: updated as WebsiteBuilderSite };
    }

    // Insert new
    const { data: inserted, error } = await client
        .from("website_builder_sites")
        .insert({ ...payload, created_at: new Date().toISOString() })
        .select()
        .single();

    if (error) return { success: false, error: error.message };
    return { success: true, site: inserted as WebsiteBuilderSite };
}

/**
 * Get a site by its ID.
 */
export async function getSiteById(
    siteId: string
): Promise<WebsiteBuilderSite | null> {
    const client = ensureClient();

    const { data, error } = await client
        .from("website_builder_sites")
        .select("*")
        .eq("id", siteId)
        .single();

    if (error) {
        console.error(`❌ getSiteById error: ${error.message}`);
        return null;
    }

    return data as WebsiteBuilderSite;
}

/**
 * Get all sites for a given owner.
 */
export async function getSitesByOwner(
    ownerUserId: string
): Promise<WebsiteBuilderSite[]> {
    const client = ensureClient();

    const { data, error } = await client
        .from("website_builder_sites")
        .select("*")
        .eq("owner_user_id", ownerUserId);

    if (error) {
        console.error(`❌ getSitesByOwner error: ${error.message}`);
        return [];
    }

    return (data ?? []) as WebsiteBuilderSite[];
}

/**
 * Create a revision record in website_builder_revisions.
 */
export async function createRevision(
    siteId: string,
    html: string,
    snapshotType: string
): Promise<{ success: boolean; revision?: WebsiteBuilderRevision; error?: string }> {
    const client = ensureClient();

    const { data, error } = await client
        .from("website_builder_revisions")
        .insert({
            site_id: siteId,
            html_content: html,
            snapshot_type: snapshotType,
            created_at: new Date().toISOString(),
        })
        .select()
        .single();

    if (error) return { success: false, error: error.message };
    return { success: true, revision: data as WebsiteBuilderRevision };
}

/**
 * Delete all sites (and their data) for a user.
 */
export async function deleteUserSites(
    ownerUserId: string
): Promise<{ success: boolean; deletedCount: number; error?: string }> {
    const client = ensureClient();

    // First get all site IDs so we can clean up revisions
    const sites = await getSitesByOwner(ownerUserId);

    if (sites.length === 0) {
        return { success: true, deletedCount: 0 };
    }

    const siteIds = sites.map((s) => s.id!);

    // Delete revisions for these sites
    const { error: revError } = await client
        .from("website_builder_revisions")
        .delete()
        .in("site_id", siteIds);

    if (revError) {
        console.error(`⚠️  Revision cleanup error: ${revError.message}`);
    }

    // Delete the sites
    const { error: siteError } = await client
        .from("website_builder_sites")
        .delete()
        .eq("owner_user_id", ownerUserId);

    if (siteError) return { success: false, deletedCount: 0, error: siteError.message };
    return { success: true, deletedCount: sites.length };
}

/**
 * Delete a single site by ID (and its revisions).
 */
export async function deleteSiteById(
    siteId: string
): Promise<{ success: boolean; error?: string }> {
    const client = ensureClient();

    // Delete revisions first
    const { error: revError } = await client
        .from("website_builder_revisions")
        .delete()
        .eq("site_id", siteId);

    if (revError) {
        console.error(`⚠️  Revision cleanup error: ${revError.message}`);
    }

    // Delete the site
    const { error } = await client
        .from("website_builder_sites")
        .delete()
        .eq("id", siteId);

    if (error) return { success: false, error: error.message };
    return { success: true };
}

// ============================================
// Storage Operations (for new buckets)
// ============================================

/**
 * Upload HTML to a specific bucket.
 */
export async function uploadToBucket(
    bucketName: string,
    path: string,
    content: string
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
    const client = ensureClient();

    const { error } = await client.storage
        .from(bucketName)
        .upload(path, content, {
            contentType: "text/html; charset=utf-8",
            upsert: true,
        });

    if (error) return { success: false, error: error.message };

    const { data: urlData } = client.storage
        .from(bucketName)
        .getPublicUrl(path);

    return { success: true, publicUrl: urlData.publicUrl };
}

/**
 * List all files in a bucket under a given prefix.
 */
export async function listBucketFiles(
    bucketName: string,
    prefix: string
): Promise<string[]> {
    const client = ensureClient();

    const { data, error } = await client.storage
        .from(bucketName)
        .list(prefix);

    if (error) {
        console.error(`❌ listBucketFiles error: ${error.message}`);
        return [];
    }

    return (data ?? []).map((f) => `${prefix}/${f.name}`);
}

/**
 * Delete files from a bucket.
 */
export async function deleteFromBucket(
    bucketName: string,
    paths: string[]
): Promise<{ success: boolean; error?: string }> {
    const client = ensureClient();

    if (paths.length === 0) return { success: true };

    const { error } = await client.storage
        .from(bucketName)
        .remove(paths);

    if (error) return { success: false, error: error.message };
    return { success: true };
}
