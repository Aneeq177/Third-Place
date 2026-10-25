import type { Plan } from "../shared/types";
import { parseISO } from "./time";

const esc = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** RFC 5545 line folding: max 75 octets per line, continuation lines start with a space. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    const limit = out.length === 0 ? 75 : 74; // continuation lines lose one octet to the leading space
    if (bytes + b > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** 20261030T010000Z */
const utc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const clock = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parseISO(iso)));

export function buildIcs(plan: Plan, groupId: string, groupName: string): string {
  const first = plan.stops[0];
  const location = first ? [first.venue.name, first.venue.address].filter(Boolean).join(", ") : "";

  const description = [
    `${groupName}: ${plan.summary}`,
    "",
    ...plan.stops.map(
      (s) => `${clock(s.start)}–${clock(s.end)} ${s.activity} at ${s.venue.name}` +
        (s.venue.address ? ` (${s.venue.address})` : ""),
    ),
    ...(plan.why.length ? ["", "Why this plan:", ...plan.why.map((w) => `- ${w}`)] : []),
  ].join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Third Place//Plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${groupId}-${plan.id}@third-place`,
    `DTSTAMP:${utc(Date.now())}`,
    `DTSTART:${utc(parseISO(plan.start))}`,
    `DTEND:${utc(parseISO(plan.end))}`,
    `SUMMARY:${esc(plan.title)}`,
    ...(location ? [`LOCATION:${esc(location)}`] : []),
    `DESCRIPTION:${esc(description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
