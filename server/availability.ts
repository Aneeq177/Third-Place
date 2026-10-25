import type { Constraints, TimeWindow, Transport } from "../shared/types";
import { MINUTE, toChicagoISO } from "./time";

export interface Overlap {
  start: string;
  end: string;
  /** Names of members free for this whole window. */
  attendees: string[];
}

interface Span {
  s: number;
  e: number;
}

function memberSpans(c: Constraints): Span[] {
  const spans = c.freeWindows
    .map((w) => ({ s: Date.parse(w.start), e: Date.parse(w.end) }))
    .filter((w) => Number.isFinite(w.s) && Number.isFinite(w.e) && w.e > w.s)
    .sort((a, b) => a.s - b.s);
  const merged: Span[] = [];
  for (const w of spans) {
    const last = merged[merged.length - 1];
    if (last && w.s <= last.e) last.e = Math.max(last.e, w.e);
    else merged.push({ ...w });
  }
  return merged;
}

/**
 * Find windows where as many members as possible are free.
 *
 * A member with no free windows said nothing about time, so they are treated as flexible
 * (free whenever). We look for windows where everyone is free first; if there are none we
 * fall back to the largest subset (at least 2 people) that shares a window of `minMinutes`.
 */
export function findOverlaps(
  constraints: Constraints[],
  minMinutes = 60,
): { windows: Overlap[]; everyone: boolean } {
  const names = constraints.map((c) => c.memberName);
  const spans = constraints.map(memberSpans);
  const fixedIdx = spans.map((s, i) => (s.length ? i : -1)).filter((i) => i >= 0);
  if (fixedIdx.length === 0) return { windows: [], everyone: false };

  const bounds = [...new Set(spans.flat().flatMap((s) => [s.s, s.e]))].sort((a, b) => a - b);

  // Elementary intervals with the set of members free throughout.
  const elementary: { s: number; e: number; who: number[] }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const s = bounds[i]!;
    const e = bounds[i + 1]!;
    const who: number[] = [];
    constraints.forEach((_, idx) => {
      const sp = spans[idx]!;
      if (sp.length === 0 || sp.some((w) => w.s <= s && w.e >= e)) who.push(idx);
    });
    elementary.push({ s, e, who });
  }

  for (let k = constraints.length; k >= Math.min(2, constraints.length); k--) {
    const merged: { s: number; e: number; who: number[] }[] = [];
    for (const iv of elementary) {
      if (iv.who.length < k) continue;
      const last = merged[merged.length - 1];
      if (last && last.e === iv.s && last.who.join() === iv.who.join()) last.e = iv.e;
      else merged.push({ ...iv });
    }
    const windows = merged
      .filter((m) => m.e - m.s >= minMinutes * MINUTE)
      .map((m) => ({
        start: toChicagoISO(m.s),
        end: toChicagoISO(m.e),
        attendees: m.who.map((i) => names[i]!),
      }))
      .sort((a, b) => b.attendees.length - a.attendees.length || Date.parse(a.start) - Date.parse(b.start));
    if (windows.length) return { windows, everyone: k === constraints.length };
  }
  return { windows: [], everyone: false };
}

/**
 * Narrow each member's free windows to the chosen overlaps so downstream ranking sees the
 * planned time. Members who are not in a window get `[]`; flexible members get the overlaps.
 */
export function clipToOverlaps(constraints: Constraints[], overlaps: Overlap[]): Constraints[] {
  return constraints.map((c) => {
    const freeWindows: TimeWindow[] = overlaps
      .filter((o) => o.attendees.includes(c.memberName))
      .map((o) => ({ start: o.start, end: o.end }));
    return { ...c, freeWindows };
  });
}

export interface AggregatedConstraints {
  memberNames: string[];
  windows: Overlap[];
  /** Intersection of budgets: highest min, lowest max. null = unconstrained. */
  budget: { min: number | null; max: number | null };
  /** Union of hard needs. */
  dietary: string[];
  accessibility: string[];
  /** Soft: vibes ordered by how many members asked for them. */
  vibes: string[];
  /** Soft: areas ordered by popularity; "" excluded. */
  areas: string[];
  transport: Transport[];
}

function rank(values: string[][]): string[] {
  const counts = new Map<string, number>();
  for (const list of values)
    for (const v of new Set(list.map((x) => x.trim().toLowerCase()).filter(Boolean)))
      counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

export function aggregate(constraints: Constraints[], windows: Overlap[]): AggregatedConstraints {
  const mins = constraints.map((c) => c.budgetPerPerson.min).filter((n): n is number => n != null);
  const maxs = constraints.map((c) => c.budgetPerPerson.max).filter((n): n is number => n != null);
  const max = maxs.length ? Math.min(...maxs) : null;
  let min = mins.length ? Math.max(...mins) : null;
  // Budgets that don't intersect: the tightest ceiling wins, drop the floor.
  if (min != null && max != null && min > max) min = null;

  const areaCounts = rank(constraints.map((c) => (c.area ? [c.area] : [])));

  return {
    memberNames: constraints.map((c) => c.memberName),
    windows,
    budget: { min, max },
    dietary: rank(constraints.map((c) => c.dietary)),
    accessibility: rank(constraints.map((c) => c.accessibility)),
    vibes: rank(constraints.map((c) => c.vibe)),
    areas: areaCounts,
    transport: rank(constraints.map((c) => c.transport)) as Transport[],
  };
}
