import { describe, expect, it } from "vitest";
import { mockArchitect } from "../agents/architect.js";
import { mockBuilder } from "../agents/builder.js";
import { BusinessInputSchema } from "../schemas/business-input.js";
import { VALID_HTML, VALID_INPUT } from "../testing/fakes.js";
import {
    describeErrors,
    extractScriptSources,
    requiredSectionIdsOf,
    validateHtml,
} from "./html-validator.js";

const codes = (html: string, options = {}) =>
    validateHtml(html, options).issues.map((issue) => issue.code);

describe("validateHtml", () => {
    it("accepts a complete, well formed document", () => {
        const report = validateHtml(VALID_HTML);
        expect(report.ok).toBe(true);
        expect(report.issues).toEqual([]);
        expect(report.sizeBytes).toBeGreaterThan(500);
    });

    it("accepts the mock builder's output, so mock mode always passes the gate", () => {
        const input = BusinessInputSchema.parse(VALID_INPUT);
        const report = validateHtml(mockBuilder(mockArchitect(input)));
        expect(report.ok).toBe(true);
    });

    it("rejects a document without a doctype", () => {
        expect(codes(VALID_HTML.replace("<!DOCTYPE html>", ""))).toContain("MISSING_DOCTYPE");
    });

    it("rejects a document that was cut off before the closing tags", () => {
        const truncated = VALID_HTML.slice(0, VALID_HTML.indexOf("<footer"));
        const report = validateHtml(truncated);
        expect(report.ok).toBe(false);
        expect(report.issues.map((i) => i.code)).toContain("TRUNCATED_DOCUMENT");
    });

    it("rejects an empty title", () => {
        expect(codes(VALID_HTML.replace("<title>Sharma Optics</title>", "<title> </title>"))).toContain(
            "MISSING_TITLE"
        );
    });

    it("rejects output that is too small or too large", () => {
        expect(codes("<!DOCTYPE html><html><head><title>x</title></head><body></body></html>")).toContain(
            "HTML_TOO_SMALL"
        );
        expect(codes(VALID_HTML, { maxBytes: 100 })).toContain("HTML_TOO_LARGE");
    });

    it("rejects a leftover markdown code fence", () => {
        expect(codes("```html\n" + VALID_HTML)).toContain("MARKDOWN_FENCE");
    });

    it("rejects scripts from hosts that are not on the allow list", () => {
        const html = VALID_HTML.replace(
            "</head>",
            '<script src="https://evil.example/tracker.js"></script></head>'
        );
        const report = validateHtml(html);
        expect(report.ok).toBe(false);
        expect(describeErrors(report)).toContain("evil.example");
    });

    it("allows sub domains of an allowed host and protocol relative URLs", () => {
        const html = VALID_HTML.replace(
            "</head>",
            '<script src="//cdn.jsdelivr.net/npm/aos@2/dist/aos.js"></script></head>'
        );
        expect(validateHtml(html).ok).toBe(true);
    });

    it("does not treat a look alike domain as allowed", () => {
        const html = VALID_HTML.replace(
            "</head>",
            '<script src="https://cdn.tailwindcss.com.evil.example/x.js"></script></head>'
        );
        expect(codes(html)).toContain("DISALLOWED_SCRIPT_HOST");
    });

    it("accepts a custom allow list", () => {
        const html = VALID_HTML.replace("</head>", '<script src="https://kit.example/a.js"></script></head>');
        expect(validateHtml(html, { allowedScriptHosts: ["cdn.tailwindcss.com", "kit.example"] }).ok).toBe(true);
    });

    it("reports missing required sections as warnings, not errors", () => {
        const report = validateHtml(VALID_HTML, { requiredSectionIds: ["hero", "gallery"] });
        expect(report.ok).toBe(true);
        expect(report.issues).toEqual([
            expect.objectContaining({ code: "MISSING_SECTION", severity: "warning" }),
        ]);
    });

    it("warns about placeholder text and images without alt text", () => {
        const html = VALID_HTML.replace(
            "<main>",
            '<main><p>[Insert Name]</p><img src="a.png"><img src="b.png" alt="Store front">'
        );
        const found = codes(html);
        expect(found).toContain("PLACEHOLDER_TEXT");
        expect(found).toContain("IMAGES_WITHOUT_ALT");
        expect(validateHtml(html).ok).toBe(true);
    });

    it("warns when the viewport tag is missing", () => {
        const html = VALID_HTML.replace(/<meta name="viewport"[^>]*>/, "");
        expect(codes(html)).toContain("MISSING_VIEWPORT");
    });
});

describe("helpers", () => {
    it("extracts script sources with any quoting style", () => {
        const html = `<script src="a.js"></script><script src='b.js'></script><script src=c.js></script><script>inline()</script>`;
        expect(extractScriptSources(html)).toEqual(["a.js", "b.js", "c.js"]);
    });

    it("lists only the sections the architect marked as required", () => {
        expect(
            requiredSectionIdsOf({
                website_generation_prompt: "x".repeat(100),
                page_sections: [
                    { section_id: "hero", section_name: "Hero", required: true },
                    { section_id: "testimonials", section_name: "Testimonials", required: false },
                ],
            })
        ).toEqual(["hero"]);
    });

    it("numbers only the blocking problems in the repair notes", () => {
        const report = validateHtml(VALID_HTML.replace("<!DOCTYPE html>", "").replace(/<meta name="viewport"[^>]*>/, ""));
        expect(describeErrors(report)).toBe("1. Document must start with <!DOCTYPE html>");
    });
});
