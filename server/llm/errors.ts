export class LlmError extends Error {
  constructor(
    public code: "NOT_CONFIGURED" | "TRANSCRIBE_FAILED" | "EXTRACT_FAILED" | "RANK_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
