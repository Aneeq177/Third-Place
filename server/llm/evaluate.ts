import type { Constraints, Venue } from "../../shared/types";
import { MIN, openIntervals, overlap, type Interval, type Segment } from "./time";

export interface FeasibleInterval extends Interval {
  free: string[];
}

export interface VenueEval {
  venue: Venue;
  /** Times the group can actually be there: inside free windows, opening hours, or the event window. */
  intervals: FeasibleInterval[];
  /** Best interval: most members free, then earliest. */
  best: FeasibleInterval;
  /** Hard problems: someone's need isn't met, they're over budget, or they aren't free. */
  violations: string[];
  /** Softer concerns. */
  concerns: string[];
  /** Plain-language things that line up with members' stated preferences. */
  matches: string[];
  /** 0-100. */
  score: number;
}

const has = (list: string[], need: string) =>
  list.some((x) => x.includes(need) || need.includes(x)) || (need === "vegetarian" && list.includes("vegan"));

const plain = (need: string) => need.replace(/^needs\s+/, "");
const money =(n: number) => `$${n}`;

export function evaluateVenue(v: Venue, cs: Constraints[], segs: Segment[], off: string): VenueEval | null {
  const intervals: FeasibleInterval[] = [];
  const minLen = v.kind === "event" ? 30 * MIN : 45 * MIN;
  for (const s of segs) {
    const within = v.event
      ? overlap(s, { start: Date.parse(v.event.start), end: v.event.end ? Date.parse(v.event.end) : Date.parse(v.event.start) + 3 * 60 * MIN })
      : s;
    if (!within) continue;
    for (const iv of openIntervals(v.event ? null : v.hours, within, off)) {
      if (iv.end - iv.start >= minLen) intervals.push({ ...iv, free: s.free });
    }
  }
  if (!intervals.length) return null;
  intervals.sort((a, b) => b.free.length - a.free.length || a.start - b.start);
  const best = intervals[0]!;

  const violations: string[] = [];
  const concerns: string[] = [];
  const matches: string[] = [];
  let score = 70;

  const servesFood = v.tags.includes("food") || v.dietary.length > 0;
  const est = v.estimatedCostPerPerson;
  const price = est ? (est.max === 0 ? "free" : `about ${money(est.min)}-${money(est.max)} per person`) : "price unknown";

  for (const c of cs) {
    const n = c.memberName;
    if (!best.free.includes(n)) {
      violations.push(`${n} isn't free during the best time for ${v.name}`);
      score -= 30;
    }
    for (const need of c.dietary) {
      if (!servesFood) continue;
      if (has(v.dietary, need)) {
        matches.push(`${n} is ${need} and ${v.name} lists ${need} options`);
        score += 4;
      } else {
        violations.push(`${n} needs ${need} food; ${v.name} doesn't list it`);
        score -= 25;
      }
    }
    for (const need of c.accessibility) {
      if (has(v.accessibility, need)) {
        matches.push(`${n} needs ${plain(need)} and ${v.name} lists it`);
        score += 4;
      } else {
        violations.push(`${n} needs ${plain(need)}; ${v.name} doesn't list it`);
        score -= 25;
      }
    }
    const max = c.budgetPerPerson.max;
    if (max != null && est) {
      if (est.min > max) {
        violations.push(`${n}'s budget is ${money(max)} but ${v.name} is ${price}`);
        score -= 25;
      } else if (est.max > max) {
        concerns.push(`${v.name} could run past ${n}'s ${money(max)} budget (${price})`);
        score -= 8;
      } else {
        matches.push(`${n} wanted to keep it under ${money(max)} and ${v.name} is ${price}`);
        score += 4;
      }
    }
    const sharedVibe = c.vibe.filter((t) => v.tags.includes(t));
    if (sharedVibe.length) {
      matches.push(`${n} wanted ${sharedVibe.join(" and ")}; ${v.name} is tagged ${sharedVibe.join(", ")}`);
      score += 6;
    } else if (v.tags.includes("crowded") && c.vibe.some((t) => t === "cozy" || t === "chill")) {
      concerns.push(`${v.name} will be crowded and ${n} wanted something ${c.vibe.find((t) => t === "cozy" || t === "chill")}`);
      score -= 8;
    }
    if (c.area && (v.area.toLowerCase().includes(c.area.toLowerCase()) || c.area.toLowerCase().includes(v.area.toLowerCase()))) {
      matches.push(`${v.name} is in ${n}'s preferred area, ${c.area}`);
      score += 5;
    }
  }

  return {
    venue: v,
    intervals,
    best,
    violations,
    concerns,
    matches,
    score: Math.max(0, Math.min(100, Math.round(score))),
  };
}
