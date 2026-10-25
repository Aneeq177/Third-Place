import { HOUR, chicagoWallToMs } from "./time";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const DATE_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i;
const WEEKDAY_RE = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b,?/gi;
const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i;

export interface ParsedEventTime {
  /** epoch ms; midnight of the first day when `timeKnown` is false */
  start: number;
  end: number | null;
  timeKnown: boolean;
}

const clean = (s: string) =>
  s.replace(/[\u202f\u00a0\u2009]/g, " ").replace(/[\u2013\u2014]/g, "–").replace(/\s+/g, " ").trim();

interface Clock {
  h: number;
  m: number;
  mer?: "AM" | "PM";
}

function readClock(text: string, allowBare: boolean): Clock | null {
  const m = TIME_RE.exec(text);
  if (!m) return null;
  const mer = m[3]?.toUpperCase() as "AM" | "PM" | undefined;
  if (!mer && !m[2] && !allowBare) return null;
  const h = Number(m[1]);
  if (h > 24) return null;
  return { h, m: Number(m[2] ?? 0), mer };
}

const to24 = (c: Clock) => (c.mer ? (c.h % 12) + (c.mer === "PM" ? 12 : 0) : c.h);

/**
 * Parse SerpApi Google Events `date.when` ("Fri, Oct 30, 7 – 10 PM", "Oct 30, 7 PM – Oct 31, 2 AM",
 * "Oct 24 – 26") with `date.start_date` ("Oct 30") as a fallback. Times are America/Chicago.
 */
export function parseEventWhen(
  when: string | undefined,
  startDate: string | undefined,
  refYear: number,
): ParsedEventTime | null {
  const text = clean(when || startDate || "");
  if (!text) return null;
  const [left = "", right = ""] = text.split(/\s*–\s*/);

  const dateL = DATE_RE.exec(left) ?? DATE_RE.exec(clean(startDate ?? ""));
  if (!dateL) return null;
  const month = MONTHS[dateL[1]!.toLowerCase().slice(0, 3)]!;
  const day = Number(dateL[2]);

  const strip = (s: string) => s.replace(DATE_RE, " ").replace(WEEKDAY_RE, " ");
  const leftClock = readClock(strip(left), true);

  const dateR = DATE_RE.exec(right);
  let endDay: { month: number; day: number } | null = dateR
    ? { month: MONTHS[dateR[1]!.toLowerCase().slice(0, 3)]!, day: Number(dateR[2]) }
    : null;
  const rightStripped = strip(right);
  let rightClock = readClock(rightStripped, !!leftClock);
  // "Oct 24 – 26": a bare number after a date-only left side is an end day, not a time.
  if (!leftClock && !dateR && /^\s*\d{1,2}\s*$/.test(rightStripped)) {
    endDay = { month, day: Number(rightStripped) };
    rightClock = null;
  }

  if (!leftClock) {
    const start = chicagoWallToMs(refYear, month, day);
    const end = endDay
      ? chicagoWallToMs(refYear, endDay.month, endDay.day) + 24 * HOUR
      : null;
    return { start, end, timeKnown: false };
  }

  // "7 – 10 PM": the start inherits PM, unless that puts it after the end ("11 – 2 PM").
  let sc = leftClock;
  if (!sc.mer && rightClock?.mer) {
    sc = { ...sc, mer: rightClock.mer };
    if (to24(sc) > to24(rightClock) && rightClock.mer === "PM") sc = { ...sc, mer: "AM" };
  }
  const start = chicagoWallToMs(refYear, month, day, to24(sc), sc.m);

  let end: number | null = null;
  if (rightClock) {
    const em = endDay?.month ?? month;
    const ed = endDay?.day ?? day;
    end = chicagoWallToMs(refYear, em, ed, to24(rightClock), rightClock.m);
    if (end <= start && !endDay) end += 24 * HOUR;
  }
  return { start, end, timeKnown: true };
}
