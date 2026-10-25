import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Constraints } from "../../shared/types";

const here = path.dirname(fileURLToPath(import.meta.url));

/** shared/constraints.schema.json, as loaded. */
export const constraintsSchema = JSON.parse(
  fs.readFileSync(path.resolve(here, "../../shared/constraints.schema.json"), "utf8"),
) as Record<string, unknown>;

/** Same schema minus $schema/$id, which strict structured-output APIs reject. */
export const constraintsApiSchema = (() => {
  const { $schema: _s, $id: _i, ...rest } = constraintsSchema;
  return rest;
})();

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(constraintsSchema);

/** Returns null when valid, otherwise a short human-readable error list. */
export function checkConstraints(data: unknown): string | null {
  if (validate(data)) return null;
  return (validate.errors ?? []).map((e) => `${e.instancePath || "(root)"} ${e.message}`).join("; ");
}

export function isConstraints(data: unknown): data is Constraints {
  return checkConstraints(data) === null;
}
