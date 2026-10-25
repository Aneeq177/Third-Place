import fs from "node:fs";
import path from "node:path";
import type { Constraints, Plan, Venue } from "../shared/types";
import { SERVER_DIR } from "./config";
import { errMessage } from "./errors";
import { log } from "./log";
import { mockConstraints, mockPlans } from "./mockData";

/** The surface server/llm/ (owned by Claude Code) must export from server/llm/index.ts. */
export interface LlmApi {
  transcribe(audio: Buffer, mime: string): Promise<string>;
  extractConstraints(input: { memberName: string; text: string }): Promise<Constraints>;
  rankPlans(constraints: Constraints[], venues: Venue[]): Promise<Plan[]>;
}

// ---------------------------------------------------------------------------------------
// Stubs backed by mock/. Used per-function until the real implementation exists.
// ---------------------------------------------------------------------------------------

const stubs: LlmApi = {
  // TODO(server/llm): replace with the real Muse/Gemini transcription.
  async transcribe() {
    return "Friday after eight works for me. I'd like live music and somewhere I can sit down. I'm vegetarian and can spend about twenty to forty dollars.";
  },

  // TODO(server/llm): replace with the real structured-output extraction.
  async extractConstraints({ memberName, text }) {
    const samples = mockConstraints();
    const match =
      samples.find((c) => c.memberName.toLowerCase() === memberName.toLowerCase()) ?? samples[0]!;
    return { ...structuredClone(match), memberName, rawTranscript: text };
  },

  // TODO(server/llm): replace with the real ranking + reasons.
  async rankPlans() {
    return mockPlans().map((p) => ({ ...p, votes: [] }));
  },
};

// ---------------------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------------------

let loading: Promise<LlmApi> | null = null;

async function load(): Promise<LlmApi> {
  const entry = ["index.ts", "index.js"].map((f) => path.join(SERVER_DIR, "llm", f)).find((f) => fs.existsSync(f));
  if (!entry) {
    log.warn("llm", "server/llm/index.ts not found: using mock-backed stubs for transcribe, extractConstraints, rankPlans");
    return stubs;
  }
  try {
    // Variable specifier: this file must compile even before server/llm/ exists.
    const spec = "./llm/index.js";
    const mod = (await import(/* @vite-ignore */ spec)) as Partial<LlmApi>;
    const api = {} as LlmApi;
    const used: string[] = [];
    const stubbed: string[] = [];
    for (const k of ["transcribe", "extractConstraints", "rankPlans"] as const) {
      if (typeof mod[k] === "function") {
        (api as unknown as Record<string, unknown>)[k] = mod[k];
        used.push(k);
      } else {
        (api as unknown as Record<string, unknown>)[k] = stubs[k];
        stubbed.push(k);
      }
    }
    log.info("llm", `using server/llm for: ${used.join(", ") || "(nothing)"}`);
    if (stubbed.length) log.warn("llm", `server/llm does not export ${stubbed.join(", ")}: using mock-backed stubs`);
    return api;
  } catch (e) {
    log.error("llm", `failed to import server/llm, falling back to stubs: ${errMessage(e)}`);
    return stubs;
  }
}

export function getLlm(): Promise<LlmApi> {
  loading ??= load();
  return loading;
}

export const stubLlm = stubs;
