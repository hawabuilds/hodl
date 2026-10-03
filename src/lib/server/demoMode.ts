/**
 * Seeded people, comments and market data (`social.ts`, `market.ts`,
 * `rng.ts`) are a local demo only. They run when `DEMO_MODE=1` and the
 * database is not configured. Off by default, so a deploy missing its
 * database settings says "data unavailable" instead of inventing people.
 */
export const DEMO_MODE = process.env.DEMO_MODE === "1";

export const DATA_UNAVAILABLE = "Data unavailable: the database isn't configured.";
