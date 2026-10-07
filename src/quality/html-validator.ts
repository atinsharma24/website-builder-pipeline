/**
 * Deterministic quality gate for generated HTML.
 *
 * The Builder agent is an LLM, so its output is untrusted until checked.
 * Every check here is plain code: the same input always gives the same
 * verdict, costs nothing, and can be unit tested. No model is asked to
 * grade another model.
 *
 * Errors block the upload and trigger a repair attempt. Warnings are
 * reported but do not block.
 *
 * These are coarse structural checks on a single generated file, done with
 * string scanning on purpose. They are not an HTML parser and do not try
 * to be one.
 */
import type { ArchitectOutput } from "../schemas/architect-output.js";

export type IssueSeverity = "error" | "warning";

export interface HtmlIssue {
    readonly code: string;
    readonly severity: IssueSeverity;
    readonly message: string;
}

export interface HtmlReport {
    /** True when there are no issues of severity "error". */
    readonly ok: boolean;
    readonly sizeBytes: number;
    readonly issues: readonly HtmlIssue[];
}

export interface HtmlValidationOptions {
    readonly minBytes: number;
    readonly maxBytes: number;
    /** Hosts that external `<script src>` tags may load from. */
    readonly allowedScriptHosts: readonly string[];
    /** Section ids the Architect marked as required. Missing ones are warnings. */
    readonly requiredSectionIds: readonly string[];
}

export const DEFAULT_ALLOWED_SCRIPT_HOSTS: readonly string[] = [
    "cdn.tailwindcss.com",
    "cdn.jsdelivr.net",
    "unpkg.com",
    "cdnjs.cloudflare.com",
];

export const DEFAULT_HTML_OPTIONS: HtmlValidationOptions = {
    minBytes: 500,
    maxBytes: 2 * 1024 * 1024,
    allowedScriptHosts: DEFAULT_ALLOWED_SCRIPT_HOSTS,
    requiredSectionIds: [],
};

function hostOf(url: string): string | undefined {
    // Protocol relative URLs (//host/path) are external too.
    const normalised = url.startsWith("//") ? `https:${url}` : url;
    if (!/^https?:\/\//i.test(normalised)) return undefined; // relative or data URL
    try {
        return new URL(normalised).hostname.toLowerCase();
    } catch {
        return undefined;
    }
}

function isAllowedHost(host: string, allowed: readonly string[]): boolean {
    return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/** Collect the `src` of every `<script>` tag that has one. */
export function extractScriptSources(html: string): string[] {
    const sources: string[] = [];
    const tagPattern = /<script\b[^>]*>/gi;
    for (const match of html.matchAll(tagPattern)) {
        const tag = match[0];
        const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
        const value = src?.[1] ?? src?.[2] ?? src?.[3];
        if (value !== undefined && value.trim() !== "") sources.push(value.trim());
    }
    return sources;
}

/** Section ids the Architect spec marks as required. */
export function requiredSectionIdsOf(spec: ArchitectOutput): string[] {
    return (spec.page_sections ?? [])
        .filter((section) => section.required !== false)
        .map((section) => section.section_id);
}

export function validateHtml(
    html: string,
    options: Partial<HtmlValidationOptions> = {}
): HtmlReport {
    const opts: HtmlValidationOptions = { ...DEFAULT_HTML_OPTIONS, ...options };
    const issues: HtmlIssue[] = [];
    const error = (code: string, message: string): void => {
        issues.push({ code, severity: "error", message });
    };
    const warning = (code: string, message: string): void => {
        issues.push({ code, severity: "warning", message });
    };

    const sizeBytes = Buffer.byteLength(html, "utf-8");
    const lower = html.toLowerCase();

    // ---- Size bounds -------------------------------------------------
    if (sizeBytes < opts.minBytes) {
        error("HTML_TOO_SMALL", `Document is ${sizeBytes} bytes, below the ${opts.minBytes} byte minimum`);
    }
    if (sizeBytes > opts.maxBytes) {
        error("HTML_TOO_LARGE", `Document is ${sizeBytes} bytes, above the ${opts.maxBytes} byte maximum`);
    }

    // ---- Structure ---------------------------------------------------
    if (!lower.trimStart().startsWith("<!doctype html")) {
        error("MISSING_DOCTYPE", "Document must start with <!DOCTYPE html>");
    }
    if (!/<html[\s>]/.test(lower)) error("MISSING_HTML_TAG", "Missing <html> element");
    if (!/<head[\s>]/.test(lower)) error("MISSING_HEAD", "Missing <head> element");
    if (!/<body[\s>]/.test(lower)) error("MISSING_BODY", "Missing <body> element");

    // A model that runs out of output tokens stops mid document. The closing
    // tags are the cheapest reliable sign that it finished.
    if (!lower.includes("</body>") || !lower.trimEnd().endsWith("</html>")) {
        error("TRUNCATED_DOCUMENT", "Document does not end with </body></html>, the output was probably cut off");
    }

    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (title === null || (title[1] ?? "").trim() === "") {
        error("MISSING_TITLE", "Missing a non empty <title>");
    }

    if (html.includes("```")) {
        error("MARKDOWN_FENCE", "Output still contains a markdown code fence");
    }

    // ---- Safety ------------------------------------------------------
    for (const src of extractScriptSources(html)) {
        const host = hostOf(src);
        if (host !== undefined && !isAllowedHost(host, opts.allowedScriptHosts)) {
            error("DISALLOWED_SCRIPT_HOST", `External script from "${host}" is not on the allow list`);
        }
    }

    // ---- Quality warnings -------------------------------------------
    if (!/<meta[^>]+name\s*=\s*["']viewport["']/i.test(html)) {
        warning("MISSING_VIEWPORT", "Missing the viewport meta tag, the page will not scale on phones");
    }
    if (!/<meta[^>]+name\s*=\s*["']description["']/i.test(html)) {
        warning("MISSING_META_DESCRIPTION", "Missing a meta description");
    }
    if (/\[insert [^\]]*\]/i.test(html) || />\s*undefined\s*</.test(html)) {
        warning("PLACEHOLDER_TEXT", "Document contains placeholder text such as [Insert ...] or undefined");
    }
    const imagesWithoutAlt = (html.match(/<img\b(?![^>]*\balt\s*=)[^>]*>/gi) ?? []).length;
    if (imagesWithoutAlt > 0) {
        warning("IMAGES_WITHOUT_ALT", `${imagesWithoutAlt} image(s) have no alt attribute`);
    }
    for (const id of opts.requiredSectionIds) {
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!new RegExp(`\\bid\\s*=\\s*["']${escaped}["']`, "i").test(html)) {
            warning("MISSING_SECTION", `No element with id="${id}" for a required section`);
        }
    }

    return { ok: !issues.some((issue) => issue.severity === "error"), sizeBytes, issues };
}

/** Render the blocking issues as instructions for a repair prompt. */
export function describeErrors(report: HtmlReport): string {
    return report.issues
        .filter((issue) => issue.severity === "error")
        .map((issue, index) => `${index + 1}. ${issue.message}`)
        .join("\n");
}
