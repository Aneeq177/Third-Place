const stamp = () => new Date().toISOString().slice(11, 23);

export const log = {
  info: (scope: string, msg: string) => console.log(`${stamp()} [${scope}] ${msg}`),
  warn: (scope: string, msg: string) => console.warn(`${stamp()} [${scope}] WARN ${msg}`),
  error: (scope: string, msg: string) => console.error(`${stamp()} [${scope}] ERROR ${msg}`),
};

/** Run one pipeline step, logging start-less completion with elapsed time (also on failure). */
export async function timed<T>(
  scope: string,
  step: string,
  fn: () => Promise<T> | T,
  describe?: (result: T) => string,
): Promise<T> {
  const t0 = performance.now();
  try {
    const result = await fn();
    const extra = describe ? ` (${describe(result)})` : "";
    log.info(scope, `${step} ok in ${Math.round(performance.now() - t0)}ms${extra}`);
    return result;
  } catch (e) {
    log.error(
      scope,
      `${step} FAILED in ${Math.round(performance.now() - t0)}ms: ${e instanceof Error ? e.message : String(e)}`,
    );
    throw e;
  }
}
