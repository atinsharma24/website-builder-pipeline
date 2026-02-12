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
    runId: string,
    architectPrompt?: string
): Promise<UploadResult> {
    if (!supabase) {
        return {
            success: false,
            error: "Supabase client not initialized. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        };
    }

    const timestamp = Date.now();
    const folderPath = `${businessSlug}/${timestamp}`;
    const storagePath = `${folderPath}/index.html`;
    const sizeBytes = Buffer.byteLength(htmlContent, "utf-8");

    console.log(`📤 Uploading to: ${BUCKET_NAME}/${storagePath} (${sizeBytes} bytes)`);

    try {
        // Build upload tasks — HTML is always uploaded; prompt is optional
        const uploadTasks: Promise<any>[] = [
            supabase.storage
                .from(BUCKET_NAME)
                .upload(storagePath, htmlContent, {
                    contentType: "text/html; charset=utf-8",
                    upsert: false,
                    cacheControl: "public, max-age=3600",
                }),
        ];

        if (architectPrompt) {
            const promptPath = `${folderPath}/architect-prompt.md`;
            const promptContent = `# Architect Generation Prompt\n\n${architectPrompt}`;
            console.log(`📝 Uploading architect prompt to: ${BUCKET_NAME}/${promptPath}`);
            uploadTasks.push(
                supabase.storage
                    .from(BUCKET_NAME)
                    .upload(promptPath, promptContent, {
                        contentType: "text/markdown; charset=utf-8",
                        upsert: false,
                    })
            );
        }

        const results = await Promise.all(uploadTasks);

        // Check HTML upload result (first task)
        const htmlResult = results[0];
        if (htmlResult.error) {
            console.error("❌ Upload error:", htmlResult.error.message);
            return {
                success: false,
                error: htmlResult.error.message,
                storagePath,
            };
        }

        // Log prompt upload result if applicable
        if (architectPrompt && results[1]?.error) {
            console.warn(`⚠️  Prompt upload failed (non-blocking): ${results[1].error.message}`);
        } else if (architectPrompt) {
            console.log(`✅ Architect prompt uploaded`);
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
