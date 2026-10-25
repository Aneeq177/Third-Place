import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));

// Repo-root .env (never committed). Real env vars win over the file.
dotenv.config({ path: path.resolve(here, "../../.env") });

export type Provider = "muse" | "gemini";

const get = (k: string) => process.env[k]?.trim() || "";

/** Read at call time so tests and late dotenv loads see current values. */
export const env = {
  museKey: () => get("MUSE_API_KEY"),
  museBaseUrl: () => get("MUSE_BASE_URL"),
  museModel: () => get("MUSE_MODEL"),
  /** Optional: a separate Muse model for audio. Falls back to MUSE_MODEL. */
  museTranscribeModel: () => get("MUSE_TRANSCRIBE_MODEL") || get("MUSE_MODEL"),
  geminiKey: () => get("GEMINI_API_KEY"),
  /** Optional override; the default is only a fallback provider's model. */
  geminiModel: () => get("GEMINI_MODEL") || "gemini-2.5-flash",
  transcribeProvider: (): Provider => (get("TRANSCRIBE_PROVIDER").toLowerCase() === "gemini" ? "gemini" : "muse"),
  /** Optional: which provider handles text/JSON calls first. Defaults to muse. */
  llmProvider: (): Provider => (get("LLM_PROVIDER").toLowerCase() === "gemini" ? "gemini" : "muse"),
};

export function isConfigured(p: Provider): boolean {
  return p === "muse" ? !!(env.museKey() && env.museBaseUrl() && env.museModel()) : !!env.geminiKey();
}

/** Primary provider first, the other as fallback; unconfigured providers are dropped. */
export function providerOrder(primary: Provider): Provider[] {
  const order: Provider[] = primary === "muse" ? ["muse", "gemini"] : ["gemini", "muse"];
  return order.filter(isConfigured);
}
