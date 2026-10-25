import type { Constraints } from "../../shared/types";
import { LlmError, errText } from "./errors";
import { EXTRACT_RETRY, EXTRACT_SYSTEM, EXTRACT_USER } from "./prompts";
import { chatJson } from "./providers";
import { checkConstraints, constraintsApiSchema } from "./schema";
import { chicagoDate } from "./time";

// A need is only kept if the text contains at least one of these stems. This is a
// backstop for "never invent dietary or accessibility needs"; the prompt does the real work.
const DIETARY_HINT =
  /veg|vegan|gluten|celiac|coeliac|halal|kosher|dairy|lactose|nut|allerg|pescatarian|alcohol|sober|dry|diet|meat|keto|paleo|shellfish|egg|soy|food|eat|restaurant/i;
const ACCESS_HINT =
  /wheelchair|accessib|seat|sit|knee|mobility|stairs|step|walk|cane|crutch|deaf|hearing|blind|vision|quiet|loud|noise|sensory|disab|injur|back|limp|elevator|ramp|stroller|chair|tired|pregnan/i;

const tag = (s: unknown) => String(s).trim().toLowerCase();
const uniq = (a: string[]) => [...new Set(a.filter(Boolean))];

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(t);
}

/** Server-owned fields, tag hygiene, bad windows, and the no-invention guard. */
function normalize(c: Constraints, memberName: string, text: string): Constraints {
  const windows = c.freeWindows.filter((w) => {
    const s = Date.parse(w.start);
    const e = Date.parse(w.end);
    return Number.isFinite(s) && Number.isFinite(e) && e > s;
  });
  let { min, max } = c.budgetPerPerson;
  if (min != null && max != null && min > max) [min, max] = [max, min];
  return {
    memberName,
    freeWindows: windows,
    budgetPerPerson: { min, max },
    vibe: uniq(c.vibe.map(tag)),
    dietary: DIETARY_HINT.test(text) ? uniq(c.dietary.map(tag)) : [],
    accessibility: ACCESS_HINT.test(text) ? uniq(c.accessibility.map(tag)) : [],
    area: c.area.trim(),
    transport: uniq(c.transport),
    rawTranscript: text,
  } as Constraints;
}

export async function extractConstraints(input: { memberName: string; text: string }): Promise<Constraints> {
  const memberName = input.memberName.trim();
  const text = input.text.trim();
  if (!text) throw new LlmError("EXTRACT_FAILED", "Empty note: nothing to extract.");

  const { date, weekday } = chicagoDate(new Date());
  const user = EXTRACT_USER({ memberName, text, referenceDate: date, weekday });
  const schema = { name: "Constraints", schema: constraintsApiSchema };

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    // Retry once on invalid JSON / schema mismatch, telling the model what was wrong.
    const prompt = attempt === 0 ? user : `${user}\n\n${EXTRACT_RETRY(lastError)}`;
    let raw: string;
    try {
      raw = (await chatJson({ system: EXTRACT_SYSTEM, user: prompt, schema, temperature: 0.1 })).text;
    } catch (e) {
      if (e instanceof LlmError) throw e;
      throw new LlmError("EXTRACT_FAILED", `Couldn't extract constraints: ${errText(e)}`);
    }
    let data: unknown;
    try {
      data = parseJson(raw);
    } catch (e) {
      lastError = `not valid JSON (${errText(e)})`;
      continue;
    }
    // memberName/rawTranscript are ours; fill them in before validating so the model can't fail on them.
    if (data && typeof data === "object") Object.assign(data, { memberName, rawTranscript: text });
    const problem = checkConstraints(data);
    if (problem) {
      lastError = problem;
      continue;
    }
    return normalize(data as Constraints, memberName, text);
  }
  throw new LlmError("EXTRACT_FAILED", `Couldn't extract constraints after a retry: ${lastError}`);
}
