import { TRANSCRIBE_GEMINI } from "./prompts";
import { transcribeAudio } from "./providers";

/** Audio -> text via TRANSCRIBE_PROVIDER (muse|gemini), falling back to the other if configured.
 *  Throws LlmError("TRANSCRIBE_FAILED" | "NOT_CONFIGURED") so the caller can ask for typed text. */
export function transcribe(audio: Buffer, mime: string): Promise<string> {
  return transcribeAudio(audio, mime, TRANSCRIBE_GEMINI);
}
