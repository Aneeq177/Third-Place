import OpenAI, { toFile } from "openai";
import { env, providerOrder, type Provider } from "./env";
import { LlmError, errText } from "./errors";

export interface JsonCall {
  system: string;
  user: string;
  /** If given, sent as a strict structured-output schema (Muse) / used for JSON mode (Gemini). */
  schema?: { name: string; schema: Record<string, unknown> };
  temperature?: number;
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const baseMime = (mime: string) => mime.split(";")[0]!.trim().toLowerCase() || "audio/webm";

function extFor(mime: string): string {
  const m = baseMime(mime);
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("flac")) return "flac";
  return "webm";
}

// ---------- Muse (OpenAI-compatible) ----------

function museClient(): OpenAI {
  return new OpenAI({ apiKey: env.museKey(), baseURL: env.museBaseUrl() });
}

async function museJson(call: JsonCall): Promise<string> {
  const client = museClient();
  const messages = [
    { role: "system" as const, content: call.system },
    { role: "user" as const, content: call.user },
  ];
  const base = { model: env.museModel(), messages, temperature: call.temperature ?? 0.2 };
  try {
    const res = await client.chat.completions.create({
      ...base,
      response_format: call.schema
        ? { type: "json_schema", json_schema: { name: call.schema.name, strict: true, schema: call.schema.schema } }
        : { type: "json_object" },
    });
    return res.choices[0]?.message?.content ?? "";
  } catch (e) {
    // Some OpenAI-compatible servers reject json_schema; retry in plain JSON mode.
    const status = (e as { status?: number }).status;
    if (call.schema && (status === 400 || status === 422)) {
      const res = await client.chat.completions.create({
        ...base,
        messages: [
          { role: "system", content: `${call.system}\n\nJSON schema to follow exactly:\n${JSON.stringify(call.schema.schema)}` },
          messages[1]!,
        ],
        response_format: { type: "json_object" },
      });
      return res.choices[0]?.message?.content ?? "";
    }
    throw e;
  }
}

async function museTranscribe(audio: Buffer, mime: string): Promise<string> {
  const file = await toFile(audio, `note.${extFor(mime)}`, { type: baseMime(mime) });
  const res = await museClient().audio.transcriptions.create({ file, model: env.museTranscribeModel() });
  return res.text ?? "";
}

// ---------- Gemini (REST, no SDK) ----------

async function geminiGenerate(parts: unknown[], opts: { system?: string; json?: boolean; temperature?: number }): Promise<string> {
  const res = await fetch(`${GEMINI_BASE}/${encodeURIComponent(env.geminiModel())}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.geminiKey() },
    body: JSON.stringify({
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: opts.temperature ?? 0.2,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}

function geminiJson(call: JsonCall): Promise<string> {
  const system = call.schema
    ? `${call.system}\n\nJSON schema to follow exactly:\n${JSON.stringify(call.schema.schema)}`
    : call.system;
  return geminiGenerate([{ text: call.user }], { system, json: true, temperature: call.temperature });
}

function geminiTranscribe(audio: Buffer, mime: string, prompt: string): Promise<string> {
  return geminiGenerate(
    [{ text: prompt }, { inline_data: { mime_type: baseMime(mime), data: audio.toString("base64") } }],
    { temperature: 0 },
  );
}

// ---------- Public helpers (provider switch + fallback) ----------

/** Tries the configured provider(s) in order and returns the first raw JSON string. */
export async function chatJson(call: JsonCall): Promise<{ text: string; provider: Provider }> {
  const order = providerOrder(env.llmProvider());
  if (!order.length) {
    throw new LlmError("NOT_CONFIGURED", "No LLM provider configured: set MUSE_API_KEY/MUSE_BASE_URL/MUSE_MODEL or GEMINI_API_KEY in .env.");
  }
  const failures: string[] = [];
  for (const p of order) {
    try {
      const text = p === "muse" ? await museJson(call) : await geminiJson(call);
      if (text.trim()) return { text, provider: p };
      failures.push(`${p}: empty response`);
    } catch (e) {
      failures.push(`${p}: ${errText(e)}`);
    }
  }
  throw new Error(`All providers failed (${failures.join(" | ")})`);
}

export async function transcribeAudio(audio: Buffer, mime: string, geminiPrompt: string): Promise<string> {
  const order = providerOrder(env.transcribeProvider());
  if (!order.length) {
    throw new LlmError("NOT_CONFIGURED", "No transcription provider configured. Ask the member to type their note instead.");
  }
  const failures: string[] = [];
  for (const p of order) {
    try {
      const text = (p === "muse" ? await museTranscribe(audio, mime) : await geminiTranscribe(audio, mime, geminiPrompt)).trim();
      if (text) return text;
      failures.push(`${p}: empty transcript`);
    } catch (e) {
      failures.push(`${p}: ${errText(e)}`);
    }
  }
  throw new LlmError(
    "TRANSCRIBE_FAILED",
    `Couldn't transcribe the audio (${failures.join(" | ")}). Ask the member to type their note instead.`,
  );
}
