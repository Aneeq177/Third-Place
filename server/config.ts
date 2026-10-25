import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SERVER_DIR, "..");

// Repo-root .env (never committed). Real env vars win over the file.
dotenv.config({ path: path.join(REPO_ROOT, ".env") });

export const config = {
  port: Number(process.env.PORT) || 8787,
  /** "*" or a comma-separated list of allowed origins. */
  corsOrigin: process.env.CORS_ORIGIN?.trim() || "*",
  serpapiKey: process.env.SERPAPI_KEY?.trim() || "",
  serpapiCacheFile:
    process.env.SERPAPI_CACHE_FILE?.trim() ||
    path.join(SERVER_DIR, "cache", "serpapi-cache.json"),
  mockDir: path.join(REPO_ROOT, "mock"),
  city: "Austin, TX",
  timeZone: "America/Chicago",
  maxAudioBytes: 5 * 1024 * 1024,
  maxTextChars: 2000,
  /** Austin city centre, used as the Maps search origin and as a fallback location. */
  austin: { lat: 30.2672, lng: -97.7431 },
} as const;
