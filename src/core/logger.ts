/**
 * Minimal structured logger contract.
 *
 * The signature (fields first, message second) matches pino, which Fastify
 * uses, so `fastify.log` can be passed straight in. Every line carries the
 * run id as a field, so one run can be followed through the logs with a
 * single filter.
 */
export interface Logger {
    info(fields: Record<string, unknown>, message: string): void;
    warn(fields: Record<string, unknown>, message: string): void;
    error(fields: Record<string, unknown>, message: string): void;
}

function write(level: string, fields: Record<string, unknown>, message: string): void {
    console.log(JSON.stringify({ level, time: new Date().toISOString(), msg: message, ...fields }));
}

/** One JSON object per line on stdout. */
export const jsonLogger: Logger = {
    info: (fields, message) => write("info", fields, message),
    warn: (fields, message) => write("warn", fields, message),
    error: (fields, message) => write("error", fields, message),
};

/** Discards everything. Used in tests. */
export const silentLogger: Logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
};
