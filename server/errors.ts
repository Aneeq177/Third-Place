import type { ApiError } from "../shared/types";

export class AppError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409 | 413 | 500 | 502,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }

  toBody(): ApiError {
    return { error: { code: this.code, message: this.message } };
  }
}

export const errMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);
