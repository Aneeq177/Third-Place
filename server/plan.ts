import type { Constraints, Group, Plan, Venue } from "../shared/types";
import { aggregate, clipToOverlaps, findOverlaps } from "./availability";
import { AppError, errMessage } from "./errors";
import type { LlmApi } from "./llmClient";
import { log, timed } from "./log";

export interface PlanDeps {
  llm: Pick<LlmApi, "rankPlans">;
  searchVenues: (agg: ReturnType<typeof aggregate>) => Promise<Venue[]>;
}

/** Make whatever rankPlans returned into exactly 3 clean, ranked, vote-free plans. */
export function normalizePlans(raw: Plan[]): [Plan, Plan, Plan] {
  if (!Array.isArray(raw) || raw.length < 3) {
    throw new AppError(
      502,
      "RANK_FAILED",
      `Ranking returned ${Array.isArray(raw) ? raw.length : 0} plans, expected 3`,
    );
  }
  const top = raw
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (b.p.score ?? 0) - (a.p.score ?? 0) || a.i - b.i)
    .slice(0, 3)
    .map(({ p }) => p);

  const ids = top.map((p) => p.id);
  const idsOk = ids.every((id) => typeof id === "string" && id) && new Set(ids).size === 3;

  return top.map((p, i) => ({
    ...p,
    id: idsOk ? p.id : `p_${i + 1}`,
    rank: (i + 1) as 1 | 2 | 3,
    why: p.why ?? [],
    tradeoffs: p.tradeoffs ?? [],
    votes: [],
  })) as unknown as [Plan, Plan, Plan];
}

/** The POST /plan pipeline. Pure with respect to the group: returns plans, caller stores them. */
export async function generatePlans(group: Group, deps: PlanDeps): Promise<[Plan, Plan, Plan]> {
  const scope = `plan ${group.id}`;
  const t0 = performance.now();

  const constraints = group.members.map((m) => m.constraints).filter((c): c is Constraints => c !== null);
  if (constraints.length < 2) {
    throw new AppError(
      409,
      "NOT_ENOUGH_NOTES",
      `Need notes from at least 2 members to plan; have ${constraints.length}`,
    );
  }

  const { agg, clipped, everyone } = await timed(
    scope,
    "1/4 merge constraints",
    () => {
      const found = findOverlaps(constraints);
      if (found.windows.length === 0) {
        throw new AppError(
          409,
          "NO_COMMON_WINDOW",
          "No shared free time of at least an hour between 2 or more members",
        );
      }
      return {
        windows: found.windows,
        everyone: found.everyone,
        agg: aggregate(constraints, found.windows),
        clipped: clipToOverlaps(constraints, found.windows),
      };
    },
    (r) =>
      `${r.windows.length} window(s), ${r.everyone ? "everyone" : "partial group"} free, first ${r.windows[0]?.start}–${r.windows[0]?.end}`,
  );
  if (!everyone) log.warn(scope, "no window where everyone is free; planning for the largest subset");

  const venues = await timed(scope, "2/4 search venues", () => deps.searchVenues(agg), (v) => `${v.length} venues`);
  if (venues.length === 0) {
    throw new AppError(502, "VENUE_SEARCH_FAILED", "No open venues or events found for the planned time");
  }

  const ranked = await timed(
    scope,
    "3/4 rank plans",
    async () => {
      try {
        return await deps.llm.rankPlans(clipped, venues);
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError(502, "RANK_FAILED", `Ranking failed: ${errMessage(e)}`);
      }
    },
    (p) => `${p.length} plans`,
  );

  const plans = await timed(scope, "4/4 normalize", () => normalizePlans(ranked), (p) =>
    p.map((x) => `${x.id}:${x.score}`).join(" "),
  );
  log.info(scope, `pipeline done in ${Math.round(performance.now() - t0)}ms`);
  return plans;
}
