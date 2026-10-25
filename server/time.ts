import { config } from "./config";

const TZ = config.timeZone;

const offsetFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  timeZoneName: "longOffset",
});

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  weekday: "long",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** UTC offset of America/Chicago at the given instant, in minutes (e.g. -300). */
export function chicagoOffsetMinutes(ms: number): number {
  const name = offsetFmt.formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -mins : mins;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** lowercase english weekday, e.g. "friday" */
  weekday: string;
}

export function chicagoParts(ms: number): LocalParts {
  const get = new Map(partsFmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    year: Number(get.get("year")),
    month: Number(get.get("month")),
    day: Number(get.get("day")),
    hour: Number(get.get("hour")),
    minute: Number(get.get("minute")),
    second: Number(get.get("second")),
    weekday: (get.get("weekday") ?? "").toLowerCase(),
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** ISO 8601 with explicit Chicago offset, e.g. 2026-10-30T19:00:00-05:00 */
export function toChicagoISO(ms: number): string {
  const p = chicagoParts(ms);
  const off = chicagoOffsetMinutes(ms);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return (
    `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export const nowISO = () => toChicagoISO(Date.now());

/** Epoch ms for a wall-clock time in America/Chicago (month is 1-12). DST-safe. */
export function chicagoWallToMs(year: number, month: number, day: number, hour = 0, minute = 0): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let t = guess - chicagoOffsetMinutes(guess) * 60_000;
  const off2 = chicagoOffsetMinutes(t);
  t = guess - off2 * 60_000;
  return t;
}

export function parseISO(s: string): number {
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`Invalid ISO datetime: ${s}`);
  return ms;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
