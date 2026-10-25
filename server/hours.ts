import { MINUTE, chicagoParts } from "./time";

export type OpenState = "open" | "closed" | "unknown";

const clean = (s: string) =>
  s
    .replace(/[\u202f\u00a0\u2009]/g, " ")
    .replace(/[\u2013\u2014]|\s-\s|\sto\s/gi, "–")
    .replace(/\s+/g, " ")
    .trim();

/** "11" / "11:30" + meridiem -> minutes after midnight. */
function toMinutes(h: number, m: number, meridiem: string | undefined): number {
  let hour = h % 12;
  if (meridiem?.toUpperCase() === "PM") hour += 12;
  if (!meridiem && h === 12) hour = 12;
  return hour * 60 + m;
}

const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?`;
const RANGE = new RegExp(`^${TIME}\\s*–\\s*${TIME}$`, "i");

/**
 * Parse one day's hours as SerpApi returns them, e.g. "11 AM–11 PM", "5–10 PM",
 * "11 AM–2 PM, 5–10 PM", "Open 24 hours", "Closed".
 * Returns open intervals in minutes after midnight; closing past midnight runs past 1440.
 * `null` = could not parse.
 */
export function parseDayHours(raw: string): { s: number; e: number }[] | null {
  const text = clean(raw);
  if (!text) return null;
  if (/^closed$/i.test(text)) return [];
  if (/24 hours|open 24/i.test(text)) return [{ s: 0, e: 1440 }];

  const out: { s: number; e: number }[] = [];
  for (const part of text.split(/\s*,\s*/)) {
    const m = RANGE.exec(part);
    if (!m) return null;
    const [, h1, m1, mer1, h2, m2, mer2] = m;
    const endMer = mer2;
    // "5–10 PM": the start inherits PM unless that would make it start after it ends.
    let startMer = mer1 ?? endMer;
    const e = toMinutes(Number(h2), Number(m2 ?? 0), endMer);
    let s = toMinutes(Number(h1), Number(m1 ?? 0), startMer);
    if (!mer1 && s > e && endMer?.toUpperCase() === "PM") {
      startMer = "AM";
      s = toMinutes(Number(h1), Number(m1 ?? 0), startMer);
    }
    out.push({ s, e: e <= s ? e + 1440 : e });
  }
  return out;
}

/**
 * Is a venue open for at least `minOverlapMin` minutes of [startMs, endMs]?
 * `hoursByDay` is SerpApi's operating_hours keyed by lowercase weekday.
 * Unknown/unparseable hours return "unknown" so the caller can keep the venue.
 */
export function openDuring(
  hoursByDay: Record<string, string> | undefined,
  startMs: number,
  endMs: number,
  minOverlapMin = 60,
): OpenState {
  if (!hoursByDay) return "unknown";
  const day = chicagoParts(startMs);
  const raw = hoursByDay[day.weekday];
  if (raw == null) return "unknown";
  const intervals = parseDayHours(raw);
  if (!intervals) return "unknown";

  const dayStart = startMs - (day.hour * 60 + day.minute) * MINUTE - day.second * 1000;
  const ws = (startMs - dayStart) / MINUTE;
  const we = (endMs - dayStart) / MINUTE;
  const need = Math.min(minOverlapMin, we - ws);
  for (const iv of intervals) {
    const overlap = Math.min(iv.e, we) - Math.max(iv.s, ws);
    if (overlap >= need) return "open";
  }
  return "closed";
}
