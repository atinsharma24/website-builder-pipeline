/**
 * Guards for values that end up inside file system paths.
 *
 * `slug` and `runId` arrive in query strings and are joined into paths under
 * the output directory. Without these checks a value such as `../../etc`
 * would let a caller read files outside that directory and publish them.
 */
import path from "node:path";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const RUN_ID_PATTERN = /^run-[0-9]{1,16}(?:-[a-z0-9]{1,16})?$/;

export function isSafeSlug(value: unknown): value is string {
    return typeof value === "string" && SLUG_PATTERN.test(value);
}

export function isSafeRunId(value: unknown): value is string {
    return typeof value === "string" && RUN_ID_PATTERN.test(value);
}

/**
 * Join segments under `root` and confirm the result is still inside `root`.
 * Returns undefined when it would escape. This is the second line of defence
 * behind the pattern checks above.
 */
export function resolveInside(root: string, ...segments: string[]): string | undefined {
    const base = path.resolve(root);
    const target = path.resolve(base, ...segments);
    const relative = path.relative(base, target);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
        return undefined;
    }
    return target;
}
