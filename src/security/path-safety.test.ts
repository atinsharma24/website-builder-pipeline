import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateRunId, slugify } from "../services/slugify.js";
import { isSafeRunId, isSafeSlug, resolveInside } from "./path-safety.js";

describe("isSafeSlug", () => {
    it("accepts slugs made by slugify", () => {
        expect(isSafeSlug("sharma-optics")).toBe(true);
        expect(isSafeSlug("a1")).toBe(true);
        expect(isSafeSlug(slugify("Satya Traders & Sons!"))).toBe(true);
    });

    it("rejects traversal, separators, uppercase and empty values", () => {
        for (const bad of ["..", "../etc", "a/b", "a\\b", "Sharma", "", "-abc", "abc-", "a.b", undefined, 42]) {
            expect(isSafeSlug(bad)).toBe(false);
        }
    });
});

describe("isSafeRunId", () => {
    it("accepts old and new run id formats", () => {
        expect(isSafeRunId("run-1770626564911")).toBe(true);
        expect(isSafeRunId(generateRunId())).toBe(true);
    });

    it("rejects anything else", () => {
        for (const bad of ["run-", "run-abc", "../run-1", "run-1/..", "task-1", "", undefined]) {
            expect(isSafeRunId(bad)).toBe(false);
        }
    });
});

describe("resolveInside", () => {
    const root = path.resolve("/srv/output");

    it("returns a path under the root", () => {
        expect(resolveInside(root, "sharma-optics", "run-1", "index.html")).toBe(
            path.join(root, "sharma-optics", "run-1", "index.html")
        );
    });

    it("returns undefined when the path would escape the root", () => {
        expect(resolveInside(root, "..", "secrets")).toBeUndefined();
        expect(resolveInside(root, "a", "..", "..", "b")).toBeUndefined();
        expect(resolveInside(root, "/etc/passwd")).toBeUndefined();
        expect(resolveInside(root)).toBeUndefined();
    });
});

describe("slugify", () => {
    it("never returns an empty slug or one that ends with a hyphen", () => {
        expect(slugify("!!!")).toBe("site");
        expect(slugify("a".repeat(49) + " b")).toBe("a".repeat(49));
        expect(slugify("  Sharma   Optics  ")).toBe("sharma-optics");
    });

    it("generates run ids that differ within the same millisecond", () => {
        const ids = new Set(Array.from({ length: 50 }, () => generateRunId()));
        expect(ids.size).toBe(50);
    });
});
