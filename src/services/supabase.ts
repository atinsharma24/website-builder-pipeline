import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn(
        "⚠️  Warning: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured"
    );
}

export const supabase = supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;

export const BUCKET_NAME = "websites";

/**
 * Upload result interface
 */
export interface UploadResult {
    success: boolean;
    publicUrl?: string;
    storagePath?: string;
    sizeBytes?: number;
    error?: string;
}

/**
 * Upload a website HTML file to Supabase Storage
 * 
 * @param businessSlug - URL-safe business name
 * @param htmlContent - The complete HTML content to upload
 * @param runId - Unique run identifier
 * @returns Upload result with public URL or error
 */
export async function uploadWebsite(
    businessSlug: string,
    htmlContent: string,
    runId: string
): Promise<UploadResult> {
    if (!supabase) {
        return {
            success: false,
            error: "Supabase client not initialized. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        };
    }

    const timestamp = Date.now();
    const storagePath = `${businessSlug}/${timestamp}/index.html`;
    const sizeBytes = Buffer.byteLength(htmlContent, "utf-8");

    console.log(`📤 Uploading to: ${BUCKET_NAME}/${storagePath} (${sizeBytes} bytes)`);

    try {
        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(storagePath, htmlContent, {
                contentType: "text/html; charset=utf-8",
                upsert: false, // Each run is unique, don't overwrite
                cacheControl: "public, max-age=3600", // 1 hour cache
            });

        if (error) {
            console.error("❌ Upload error:", error.message);
            return {
                success: false,
                error: error.message,
                storagePath,
            };
        }

        // Get public URL
        const { data: urlData } = supabase.storage
            .from(BUCKET_NAME)
            .getPublicUrl(storagePath);

        console.log(`✅ Upload successful: ${urlData.publicUrl}`);

        return {
            success: true,
            publicUrl: urlData.publicUrl,
            storagePath,
            sizeBytes,
        };
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.error("❌ Upload exception:", errorMessage);
        return {
            success: false,
            error: errorMessage,
            storagePath,
        };
    }
}

/**
 * Check if the websites bucket exists and is accessible
 */
export async function checkBucketExists(): Promise<boolean> {
    if (!supabase) {
        console.error("❌ Supabase client not initialized");
        return false;
    }

    try {
        const { data, error } = await supabase.storage.getBucket(BUCKET_NAME);

        if (error) {
            console.error(`❌ Bucket "${BUCKET_NAME}" not found:`, error.message);
            return false;
        }

        console.log(`✅ Bucket "${BUCKET_NAME}" exists and is accessible`);
        return true;
    } catch (err) {
        console.error("❌ Error checking bucket:", err);
        return false;
    }
}

/**
 * Generate a signed URL for private bucket access (if needed)
 */
export async function getSignedUrl(
    storagePath: string,
    expiresInSeconds: number = 3600
): Promise<string | null> {
    if (!supabase) return null;

    try {
        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .createSignedUrl(storagePath, expiresInSeconds);

        if (error) {
            console.error("❌ Signed URL error:", error.message);
            return null;
        }

        return data.signedUrl;
    } catch (err) {
        console.error("❌ Signed URL exception:", err);
        return null;
    }
}
