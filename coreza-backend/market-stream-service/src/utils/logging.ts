// Load .env before capturing the startup switch or muting console methods.
import "dotenv/config";

/**
 * One startup switch for application logging. Unset/non-debug values are silent.
 * Import before application modules so startup console output is gated too.
 */
export const LOG = process.env.LOG_LEVEL === "debug";

if (!LOG) {
  // Existing console callers share the same policy as structured/HTTP loggers.
  // Gate output only; never suppress application work or error propagation.
  const methods = [
    "log", "info", "debug", "warn", "error", "trace", "dir", "dirxml",
    "table", "assert", "count", "countReset", "group", "groupCollapsed",
    "groupEnd", "time", "timeEnd", "timeLog", "clear", "profile",
    "profileEnd", "timeStamp",
  ] as const;
  for (const method of methods) console[method] = () => {};
}
