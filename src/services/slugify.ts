/**
 * Slugify utility for creating safe URL-friendly business name slugs
 */
import { randomBytes } from "node:crypto";

/**
 * Convert a business name to a URL-safe slug
 * - Converts to lowercase
 * - Replaces spaces with hyphens
 * - Removes special characters
 * - Removes consecutive hyphens
 * - Limits length to 50 characters
 * - Trims leading/trailing hyphens (after the length cut, so a cut can never leave one behind)
 *
 * A name with no usable characters (for example only symbols) becomes "site",
 * so the slug is never empty and is always safe to use as a path segment.
 */
export function slugify(text: string): string {
    const slug = text
        .toLowerCase()
        .trim()
        // Replace spaces with hyphens
        .replace(/\s+/g, "-")
        // Remove special characters (keep alphanumeric and hyphens)
        .replace(/[^a-z0-9-]/g, "")
        // Remove consecutive hyphens
        .replace(/-+/g, "-")
        // Limit length to 50 characters
        .substring(0, 50)
        // Remove leading/trailing hyphens
        .replace(/^-+|-+$/g, "");
    return slug === "" ? "site" : slug;
}

/**
 * Generate a unique run ID: millisecond timestamp plus a random suffix.
 * The timestamp keeps ids sortable. The suffix stops two requests that
 * arrive in the same millisecond from sharing an id.
 */
export function generateRunId(): string {
    return `run-${Date.now()}-${randomBytes(4).toString("hex")}`;
}
