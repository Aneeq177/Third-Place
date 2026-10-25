import type { Constraints, Plan, PlanStop, Venue } from "../../shared/types";
import { evaluateVenue, type VenueEval } from "./evaluate";
import { LlmError, errText } from "./errors";
import { RANK_RETRY, RANK_SYSTEM, RANK_USER } from "./prompts";
import { chatJson } from "./providers";
import { MIN, bestOverlaps, fmt, offsetOf, type Interval } from "./time";

const MAX_CANDIDATES = 12;
const MAX_STOP = 150 * MIN;
const MIN_STOP = 30 * MIN;
const BUFFER = 15 * MIN;

interface RawPlan {
  title?: unknown;
  summary?: unknown;
  stops?: { venueId?: unknown; start?: unknown; end?: unknown; activity?: unknown }[];
  why?: unknown;
  tradeoffs?: unknown;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Fri 8:00-11:00 PM" in the plan's own offset. */
function when(startMs: number, endMs: number, off: string): string {
  const [sign, hh, mm] = [off[0] === "-" ? -1 : 1, Number(off.slice(1, 3)), Number(off.slice(4, 6))];
  const shift = sign * (hh * 60 + mm) * MIN;
  const a = new Date(startMs + shift);
  const b = new Date(endMs + shift);
  const t = (d: Date) => {
    const h = d.getUTCHours();
    return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  return `${DAYS[a.getUTCDay()]} ${t(a)} to ${t(b)}`;
}

const strings = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean) : [];

// ---------- stop building (clamp the model's times into feasible time) ----------

/** Places a stop for `ev` inside a feasible interval, no earlier than `notBefore`. null if it can't fit. */
function placeStop(ev: VenueEval, want: Interval | null, notBefore: number): Interval | null {
  const fits = ev.intervals.filter((iv) => iv.end - Math.max(iv.start, notBefore) >= MIN_STOP);
  if (!fits.length) return null;
  const home =
    (want && fits.find((iv) => want.start >= iv.start && want.start < iv.end)) ??
    fits.find((iv) => iv === ev.best) ??
    fits[0]!;
  let start = Math.max(home.start, notBefore, want?.start ?? home.start);
  if (home.end - start < MIN_STOP) start = Math.max(home.start, notBefore);
  let end = want ? Math.min(want.end, home.end) : Math.min(home.end, start + 120 * MIN);
  if (end - start < MIN_STOP) end = Math.min(home.end, start + 90 * MIN);
  end = Math.min(end, start + MAX_STOP);
  return end > start ? { start, end } : null;
}

function activityFor(v: Venue): string {
  if (v.kind === "event") return "Event";
  if (v.tags.includes("live music")) return "Live music";
  if (v.tags.includes("movies")) return "Movie";
  if (v.tags.includes("food")) return "Food";
  if (v.tags.includes("outdoors")) return "Outdoors";
  return "Hang out";
}

function buildPlan(
  parts: { ev: VenueEval; want: Interval | null; activity?: string }[],
  text: { title?: string; summary?: string; why: string[]; tradeoffs: string[] },
  ctx: { off: string; n: number },
): Omit<Plan, "id" | "rank"> | null {
  const stops: PlanStop[] = [];
  const used: VenueEval[] = [];
  let cursor = -Infinity;
  for (const p of [...parts].sort((a, b) => (a.want?.start ?? a.ev.best.start) - (b.want?.start ?? b.ev.best.start))) {
    const slot = placeStop(p.ev, p.want, stops.length ? cursor + BUFFER : cursor);
    if (!slot) continue;
    stops.push({
      venue: p.ev.venue,
      start: fmt(slot.start, ctx.off),
      end: fmt(slot.end, ctx.off),
      activity: p.activity?.slice(0, 40) || activityFor(p.ev.venue),
    });
    used.push(p.ev);
    cursor = slot.end;
    if (stops.length === 2) break;
  }
  if (!stops.length) return null;

  const score = Math.round(used.reduce((s, e) => s + e.score, 0) / used.length);
  const cost = stops.reduce(
    (c, s) => ({
      min: c.min + (s.venue.estimatedCostPerPerson?.min ?? 0),
      max: c.max + (s.venue.estimatedCostPerPerson?.max ?? 0),
    }),
    { min: 0, max: 0 },
  );
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  const names = used.map((e) => e.venue.name).join(" then ");

  // Always surface honest downsides, even if the model forgot them.
  const tradeoffs = text.tradeoffs.length
    ? text.tradeoffs
    : [...used.flatMap((e) => e.violations), ...used.flatMap((e) => e.concerns)];
  const why = [...text.why];
  for (const e of used) for (const m of e.matches) if (why.length < 2 && !why.includes(m)) why.push(m);
  if (why.length < 2) {
    const free = used[0]!.best.free;
    why.push(
      free.length === ctx.n
        ? `All ${ctx.n} of you are free ${when(Date.parse(first.start), Date.parse(last.end), ctx.off)}`
        : `${free.join(", ")} can make ${when(Date.parse(first.start), Date.parse(last.end), ctx.off)}`,
    );
  }

  return {
    title: text.title?.slice(0, 80) || names,
    summary: text.summary?.slice(0, 200) || `${names}, ${when(Date.parse(first.start), Date.parse(last.end), ctx.off)}.`,
    start: first.start,
    end: last.end,
    stops,
    estimatedCostPerPerson: cost,
    score,
    why: why.slice(0, 3),
    tradeoffs: tradeoffs.slice(0, 2),
    votes: [],
  };
}

// ---------- model call ----------

function payload(cs: Constraints[], cands: VenueEval[], off: string): string {
  return JSON.stringify({
    members: cs.map((c) => ({
      name: c.memberName,
      freeWindows: c.freeWindows,
      budgetPerPerson: c.budgetPerPerson,
      vibe: c.vibe,
      dietary: c.dietary,
      accessibility: c.accessibility,
      area: c.area,
      transport: c.transport,
      saidInTheirOwnWords: c.rawTranscript,
    })),
    candidates: cands.map((e) => ({
      venueId: e.venue.id,
      name: e.venue.name,
      kind: e.venue.kind,
      category: e.venue.category,
      area: e.venue.area,
      priceLevel: e.venue.priceLevel,
      estimatedCostPerPerson: e.venue.estimatedCostPerPerson,
      rating: e.venue.rating,
      hours: e.venue.hours,
      event: e.venue.event,
      tags: e.venue.tags,
      dietary: e.venue.dietary,
      accessibility: e.venue.accessibility,
      feasible: e.intervals.map((iv) => ({ start: fmt(iv.start, off), end: fmt(iv.end, off), freeMembers: iv.free })),
      violations: e.violations,
      concerns: e.concerns,
      matches: e.matches,
    })),
  });
}

async function askModel(cs: Constraints[], cands: VenueEval[], off: string): Promise<RawPlan[]> {
  const user = RANK_USER(payload(cs, cands, off));
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? user : `${user}\n\n${RANK_RETRY(lastError)}`;
    const { text } = await chatJson({ system: RANK_SYSTEM, user: prompt, temperature: 0.4 });
    try {
      const data = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { plans?: unknown };
      if (Array.isArray(data.plans) && data.plans.length) return data.plans as RawPlan[];
      lastError = "missing a non-empty \"plans\" array";
    } catch (e) {
      lastError = `not valid JSON (${errText(e)})`;
    }
  }
  throw new Error(lastError);
}

// ---------- public ----------

/** Exactly 3 ranked plans. The model proposes and explains; code enforces times, venues and scores,
 *  and fills in deterministic plans if the model is unavailable or returns too few usable ones. */
export async function rankPlans(constraints: Constraints[], venues: Venue[]): Promise<Plan[]> {
  if (!constraints.length) throw new LlmError("RANK_FAILED", "No member constraints to plan from.");
  const segs = bestOverlaps(constraints);
  if (!segs.length) throw new LlmError("RANK_FAILED", "No shared free time: members' free windows don't overlap long enough.");

  const off = offsetOf(segs[0] && constraints.flatMap((c) => c.freeWindows)[0]?.start);
  const ctx = { off, n: constraints.length };
  const evals = venues.map((v) => evaluateVenue(v, constraints, segs, off)).filter((e): e is VenueEval => !!e);
  if (evals.length < 3) {
    throw new LlmError(
      "RANK_FAILED",
      `Only ${evals.length} venue(s) are open during the group's shared free time; need at least 3 to build 3 plans.`,
    );
  }
  evals.sort((a, b) => b.score - a.score);
  const byId = new Map(evals.map((e) => [e.venue.id, e]));

  const built: Omit<Plan, "id" | "rank">[] = [];
  const seen = new Set<string>();
  const add = (p: Omit<Plan, "id" | "rank"> | null) => {
    if (!p) return;
    const key = p.stops.map((s) => s.venue.id).sort().join("+");
    // Plans must differ: skip repeats and any plan whose main venue already appears in another plan.
    if (seen.has(key) || seen.has(`used:${p.stops[0]!.venue.id}`)) return;
    seen.add(key);
    for (const s of p.stops) seen.add(`used:${s.venue.id}`);
    built.push(p);
  };

  try {
    const raw = await askModel(constraints, evals.slice(0, MAX_CANDIDATES), off);
    for (const r of raw) {
      const parts = (r.stops ?? []).flatMap((s) => {
        const ev = typeof s.venueId === "string" ? byId.get(s.venueId) : undefined;
        if (!ev) return [];
        const start = typeof s.start === "string" ? Date.parse(s.start) : NaN;
        const end = typeof s.end === "string" ? Date.parse(s.end) : NaN;
        return [{
          ev,
          want: Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null,
          activity: typeof s.activity === "string" ? s.activity.trim() : undefined,
        }];
      });
      add(
        buildPlan(
          parts,
          {
            title: typeof r.title === "string" ? r.title.trim() : undefined,
            summary: typeof r.summary === "string" ? r.summary.trim() : undefined,
            why: strings(r.why),
            tradeoffs: strings(r.tradeoffs),
          },
          ctx,
        ),
      );
    }
  } catch (e) {
    if (!(e instanceof LlmError && e.code === "NOT_CONFIGURED")) {
      console.warn(`[llm] rankPlans: model unavailable, using deterministic plans: ${errText(e)}`);
    }
  }

  // Top up with the best remaining venues (templated reasons built from real data).
  for (const ev of evals) {
    if (built.length >= 3) break;
    add(buildPlan([{ ev, want: null }], { why: [], tradeoffs: [] }, ctx));
  }
  if (built.length < 3) {
    throw new LlmError("RANK_FAILED", "Couldn't build 3 distinct plans from the available venues.");
  }

  return built
    .slice(0, 3)
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ ...p, id: `p_${i + 1}`, rank: (i + 1) as 1 | 2 | 3 }));
}
