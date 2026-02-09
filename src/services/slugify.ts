/**
 * Slugify utility for creating safe URL-friendly business name slugs
 */

/**
 * Convert a business name to a URL-safe slug
 * - Converts to lowercase
 * - Replaces spaces with hyphens
 * - Removes special characters
 * - Removes consecutive hyphens
 * - Trims leading/trailing hyphens
 */
export function slugify(text: string): string {
    return text
        .toLowerCase()
        .trim()
        // Replace spaces with hyphens
        .replace(/\s+/g, "-")
        // Remove special characters (keep alphanumeric and hyphens)
        .replace(/[^a-z0-9-]/g, "")
        // Remove consecutive hyphens
        .replace(/-+/g, "-")
        // Remove leading/trailing hyphens
        .replace(/^-|-$/g, "")
        // Limit length to 50 characters
        .substring(0, 50);
}

/**
 * Generate a unique run ID with timestamp
 */
export function generateRunId(): string {
    return `run-${Date.now()}`;
}
