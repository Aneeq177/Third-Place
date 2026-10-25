import type { Constraints } from "../../shared/types";

export const MIN = 60_000;
export const DAY = 24 * 60 * MIN;

export interface Interval {
  start: number;
  end: number;
}

/** Today's date and weekday in America/Chicago. */
export function chicagoDate(now: Date): { date: string; weekday: string } {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", ...o });
  const parts = Object.fromEntries(
    f({ year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: f({ weekday: "long" }).format(now) };
}

/** "-05:00" style offset found in an ISO string; defaults to Austin's current-ish CDT. */
export function offsetOf(iso: string | undefined): string {
  const m = iso?.match(/([+-]\d{2}:\d{2})$/);
  return m ? m[1]! : iso?.endsWith("Z") ? "+00:00" : "-05:00";
}

const offsetMinutes = (off: string) => {
  const sign = off.startsWith("-") ? -1 : 1;
  return sign * (Number(off.slice(1, 3)) * 60 + Number(off.slice(4, 6)));
};

/** epoch ms -> ISO string with the given offset. */
export function fmt(ms: number, off: string): string {
  return new Date(ms + offsetMinutes(off) * MIN).toISOString().slice(0, 19) + off;
}

export const overlap = (a: Interval, b: Interval): Interval | null => {
  const s = Math.max(a.start, b.start);
  const e = Math.min(a.end, b.end);
  return e > s ? { start: s, end: e } : null;
};

export interface Segment extends Interval {
  free: string[];
}

/** Time ranges (>= minMs) where the most members are simultaneously free.
 *  If everyone overlaps, that's the result; otherwise the best partial overlap. */
export function bestOverlaps(cs: Constraints[], minMs = 45 * MIN): Segment[] {
  const wins = cs.map((c) =>
    c.freeWindows
      .map((w) => ({ start: Date.parse(w.start), end: Date.parse(w.end) }))
      .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start),
  );
  const points = [...new Set(wins.flat().flatMap((w) => [w.start, w.end]))].sort((a, b) => a - b);

  const raw: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const free = cs.filter((_, k) => wins[k]!.some((w) => w.start <= a && w.end >= b)).map((c) => c.memberName);
    if (free.length) raw.push({ start: a, end: b, free });
  }
  // merge adjacent segments with identical member sets
  const merged: Segment[] = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && last.end === s.start && last.free.join("|") === s.free.join("|")) last.end = s.end;
    else merged.push({ ...s });
  }
  for (let n = cs.length; n >= 1; n--) {
    const tier = merged.filter((s) => s.free.length === n && s.end - s.start >= minMs);
    if (tier.length) return tier;
  }
  return [];
}

// ---------- venue opening hours ----------

const HOURS = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i;

function toMin(h: string, m: string | undefined, ap: string): number {
  let hh = Number(h) % 12;
  if (ap.toUpperCase() === "PM") hh += 12;
  return hh * 60 + Number(m ?? 0);
}

/** Opening range in minutes after local midnight; close may exceed 1440 (past midnight). null = unknown/always. */
export function parseHours(s: string | null): { open: number; close: number } | null {
  if (!s) return null;
  const m = s.match(HOURS);
  if (!m) return null;
  const open = toMin(m[1]!, m[2], m[3]!);
  let close = toMin(m[4]!, m[5], m[6]!);
  if (close <= open) close += 1440;
  return { open, close };
}

/** Parts of `within` when the venue is open (hours repeat daily; events use their own window). */
export function openIntervals(hours: string | null, within: Interval, off: string): Interval[] {
  const range = parseHours(hours);
  if (!range) return [within];
  const o = offsetMinutes(off) * MIN;
  const localMidnight = Math.floor((within.start + o) / DAY) * DAY - o;
  const out: Interval[] = [];
  for (let d = -1; d <= 1; d++) {
    const base = localMidnight + d * DAY;
    const hit = overlap(within, { start: base + range.open * MIN, end: base + range.close * MIN });
    if (hit) out.push(hit);
  }
  return out;
}
