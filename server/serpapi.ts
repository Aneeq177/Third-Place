import { createHash } from "node:crypto";
import type { Venue } from "../shared/types";
import type { AggregatedConstraints, Overlap } from "./availability";
import { JsonFileCache } from "./cache";
import { config } from "./config";
import { AppError, errMessage } from "./errors";
import { parseEventWhen } from "./eventTime";
import { openDuring, parseDayHours } from "./hours";
import { log } from "./log";
import { mockVenues } from "./mockData";
import { areaFromLocation, areaFromZip } from "./neighborhoods";
import { HOUR, chicagoParts, toChicagoISO } from "./time";

const SCOPE = "serpapi";
const SERPAPI_URL = "https://serpapi.com/search.json";
const MIN_RATING = 3.8;
const MAX_PLACES = 30;
const MAX_EVENTS = 10;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export class MissingKeyError extends Error {}

export interface SerpDeps {
  apiKey: string;
  cache: JsonFileCache;
  fetchFn: typeof fetch;
}

// ---------------------------------------------------------------------------------------
// Transport: cache first, network second
// ---------------------------------------------------------------------------------------

const KEEP_KEYS = ["local_results", "place_results", "events_results"];

function cacheKey(engine: string, params: Record<string, string>): string {
  const q = Object.keys(params)
    .filter((k) => k !== "api_key")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return `${engine}?${q}`;
}

async function serpGet(
  engine: "google_maps" | "google_events",
  params: Record<string, string>,
  deps: SerpDeps,
): Promise<{ data: Json; cached: boolean }> {
  const key = cacheKey(engine, params);
  const hit = deps.cache.get(key);
  if (hit !== undefined) return { data: hit, cached: true };
  if (!deps.apiKey) throw new MissingKeyError("SERPAPI_KEY is not set and the response is not cached");

  const url = new URL(SERPAPI_URL);
  for (const [k, v] of Object.entries({ engine, ...params, api_key: deps.apiKey })) url.searchParams.set(k, v);
  const res = await deps.fetchFn(url, { signal: AbortSignal.timeout(20_000) });
  const body = (await res.json().catch(() => ({}))) as Json;

  const noResults = typeof body.error === "string" && /hasn't returned any results/i.test(body.error);
  if (!res.ok && !noResults) throw new Error(`SerpApi ${res.status}: ${body.error ?? res.statusText}`);
  if (body.error && !noResults) throw new Error(`SerpApi: ${body.error}`);

  const trimmed: Json = {};
  for (const k of KEEP_KEYS) if (body[k] !== undefined) trimmed[k] = body[k];
  await deps.cache.set(key, trimmed);
  return { data: trimmed, cached: false };
}

// ---------------------------------------------------------------------------------------
// Query building from aggregated constraints
// ---------------------------------------------------------------------------------------

const VIBE_TERMS: Record<string, string> = {
  "live music": "live music venues",
  outdoors: "outdoor activities parks",
  cozy: "cozy cafes",
  chill: "chill hangout spots",
  active: "active outdoor activities",
  "late night": "late night bars",
  drinks: "bars",
  games: "arcade bars board game cafes",
  movies: "movie theaters",
  dancing: "dance clubs",
  coffee: "coffee shops",
  "coffee shop": "coffee shops",
  cafe: "cafes coffee shops",
  café: "cafes coffee shops",
  tea: "tea houses coffee shops",
  brewery: "breweries",
  museum: "museums",
  bookstore: "bookstores",
  food: "restaurants",
};

function formatLoc(area: string): string {
  if (!area) return config.city;
  return /austin/i.test(area) ? `${area}, TX` : `${area}, Austin, TX`;
}

function placeQuery(vibe: string): string {
  return VIBE_TERMS[vibe] ?? vibe;
}

const FOODISH = /food|dinner|lunch|restaurant|eat|brunch/;

export function buildMapsQueries(agg: AggregatedConstraints): string[] {
  const locs = (agg.areas.length ? agg.areas.slice(0, 2) : [""]).map(formatLoc);
  const queries: string[] = [];
  const foodish = agg.vibes.some((v) => FOODISH.test(v));
  for (const loc of locs) {
    for (const v of agg.vibes.slice(0, 4)) queries.push(`${placeQuery(v)} in ${loc}`);
    if (agg.dietary.length && (foodish || agg.vibes.length === 0)) {
      queries.push(`${agg.dietary.join(" ")} restaurants in ${loc}`);
    }
    if (agg.vibes.length === 0 && !agg.dietary.length) queries.push(`cafes and hangout spots in ${loc}`);
  }
  return [...new Set(queries.map((q) => q.replace(/\s+/g, " ").trim()))].slice(0, 6);
}

export function buildEventQueries(agg: AggregatedConstraints): string[] {
  const queries = [`events in ${config.city}`];
  for (const vibe of agg.vibes.slice(0, 2)) {
    if (vibe !== "food") queries.push(`${placeQuery(vibe)} events in ${config.city}`);
  }
  return [...new Set(queries)].slice(0, 4);
}

/** google_events only supports coarse date chips; we filter precisely afterwards. */
function dateChip(windows: Overlap[]): string {
  const first = windows[0] ? Date.parse(windows[0].start) : Date.now();
  const today = chicagoParts(Date.now());
  const target = chicagoParts(first);
  const dayDiff = Math.round(
    (Date.UTC(target.year, target.month - 1, target.day) - Date.UTC(today.year, today.month - 1, today.day)) /
      (24 * HOUR),
  );
  if (dayDiff <= 0) return "date:today";
  if (dayDiff === 1) return "date:tomorrow";
  if (dayDiff <= 7) return "date:week";
  if (dayDiff <= 14) return "date:next_week";
  return today.month === target.month ? "date:month" : "date:next_month";
}

// ---------------------------------------------------------------------------------------
// Mapping SerpApi -> Venue
// ---------------------------------------------------------------------------------------

const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 10);
const norm = (s: string) => s.replace(/[\u202f\u00a0\u2009]/g, " ").replace(/\s+/g, " ").trim();

function deepStrings(x: Json, out: string[] = []): string[] {
  if (typeof x === "string") out.push(x);
  else if (Array.isArray(x)) x.forEach((v) => deepStrings(v, out));
  else if (x && typeof x === "object") Object.values(x).forEach((v) => deepStrings(v, out));
  return out;
}

const PRICE_COST: Record<number, { min: number; max: number }> = {
  1: { min: 5, max: 15 },
  2: { min: 15, max: 30 },
  3: { min: 30, max: 60 },
  4: { min: 60, max: 120 },
};

function parsePrice(
  raw: unknown,
): { level: 1 | 2 | 3 | 4 | null; cost: { min: number; max: number } | null } {
  if (typeof raw !== "string" || !raw.trim()) return { level: null, cost: null };
  const text = norm(raw);
  if (/^free$/i.test(text)) return { level: null, cost: { min: 0, max: 0 } };
  const dollars = /^\$+$/.exec(text);
  if (dollars) {
    const level = Math.min(4, dollars[0].length) as 1 | 2 | 3 | 4;
    return { level, cost: PRICE_COST[level] ?? null };
  }
  const nums = text.match(/\d+/g)?.map(Number) ?? [];
  if (nums.length) {
    const max = Math.max(...nums);
    const min = nums.length > 1 ? Math.min(...nums) : Math.max(0, max - 10);
    const level = (max <= 10 ? 1 : max <= 20 ? 2 : max <= 30 ? 3 : 4) as 1 | 2 | 3 | 4;
    return { level, cost: { min, max } };
  }
  return { level: null, cost: null };
}

const TAG_RULES: [RegExp, string][] = [
  [/live music|music venue|concert|jazz|blues|honky|karaoke|band\b/i, "live music"],
  [/\bbar\b|\bpub\b|brewery|beer|cocktail|wine|taproom|distillery|saloon|lounge/i, "drinks"],
  [/park\b|trail|garden|lake|outdoor|patio|swimming|hike|kayak|paddle|nature/i, "outdoors"],
  [/restaurant|cafe|coffee|bakery|taco|bbq|barbecue|diner|pizza|brunch|eatery|bistro|food truck|kitchen/i, "food"],
  [/cafe|coffee|tea house|bookstore|book store/i, "chill"],
  [/movie|cinema|theater|theatre/i, "movies"],
  [/arcade|bowling|escape room|mini golf|board game|billiard|pool hall|axe/i, "games"],
  [/climbing|yoga|skate|bike|gym|fitness|sports|trampoline|hiking/i, "active"],
  [/night ?club|dance|dj\b/i, "dancing"],
];

function inferTags(text: string, lateNight: boolean): string[] {
  const tags = new Set<string>();
  for (const [re, tag] of TAG_RULES) if (re.test(text)) tags.add(tag);
  if (lateNight) tags.add("late night");
  return [...tags];
}

function inferDietary(text: string): string[] {
  const out = new Set<string>();
  if (/vegetarian/i.test(text)) out.add("vegetarian");
  if (/vegan/i.test(text)) {
    out.add("vegan");
    out.add("vegetarian");
  }
  if (/gluten[- ]free/i.test(text)) out.add("gluten-free");
  if (/halal/i.test(text)) out.add("halal");
  if (/kosher/i.test(text)) out.add("kosher");
  return [...out];
}

function inferAccessibility(text: string, category: string): string[] {
  const out = new Set<string>();
  if (/wheelchair[- ]accessible/i.test(text)) out.add("wheelchair accessible");
  if (/dine-in|table service|seating|restaurant|cafe|coffee|theat(er|re)/i.test(`${text} ${category}`))
    out.add("needs seating");
  return [...out];
}

/** True when the venue is open until 1 AM or later on the planned day. */
function closesLate(hoursByDay: Record<string, string> | undefined, windows: Overlap[]): boolean {
  if (!hoursByDay || !windows[0]) return false;
  const raw = hoursByDay[chicagoParts(Date.parse(windows[0].start)).weekday];
  const intervals = raw ? parseDayHours(raw) : null;
  return !!intervals?.some((iv) => iv.e >= 1440 + 60 && iv.e < 1440 * 2);
}

const mapsUrl = (placeId: string | null, title: string, address: string) =>
  placeId
    ? `https://www.google.com/maps/place/?q=place_id:${placeId}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${title} ${address}`)}`;

/** Returns the venue, "closed" when it is shut for the planned time, or null if unusable. */
export function mapPlace(r: Json, windows: Overlap[]): Venue | "closed" | null {
  const name = norm(String(r?.title ?? ""));
  const lat = r?.gps_coordinates?.latitude;
  const lng = r?.gps_coordinates?.longitude;
  if (!name || typeof lat !== "number" || typeof lng !== "number") return null;

  const hoursByDay: Record<string, string> | undefined =
    r.operating_hours && typeof r.operating_hours === "object" ? r.operating_hours : undefined;

  if (hoursByDay && windows.length) {
    const states = windows.map((w) => openDuring(hoursByDay, Date.parse(w.start), Date.parse(w.end)));
    if (states.every((s) => s === "closed")) return "closed";
  }

  const placeId: string | null = r.place_id ?? r.data_id ?? null;
  const address = norm(String(r.address ?? ""));
  const category = norm(String(r.type ?? r.types?.[0] ?? "Place"));
  const text = [name, category, ...(Array.isArray(r.types) ? r.types : []), ...deepStrings(r.extensions)].join(" ");
  const { level, cost } = parsePrice(r.price);
  const dayKey = chicagoParts(Date.parse(windows[0]?.start ?? new Date().toISOString())).weekday;
  const hours = hoursByDay?.[dayKey] ? norm(hoursByDay[dayKey]!.replace(/\s*–\s*/g, " – ")) : null;
  const isPark = /park|trail|garden|nature/i.test(category);

  return {
    id: `v_${sha(placeId ?? `${name}|${address}`)}`,
    kind: "place",
    name,
    category,
    address,
    area: areaFromLocation(lat, lng, address),
    location: { lat, lng },
    rating: typeof r.rating === "number" ? r.rating : null,
    reviewCount: typeof r.reviews === "number" ? r.reviews : null,
    priceLevel: level,
    estimatedCostPerPerson: cost ?? (level == null && isPark ? { min: 0, max: 0 } : null),
    hours,
    event: null,
    tags: inferTags(text, closesLate(hoursByDay, windows)),
    dietary: inferDietary(text),
    accessibility: inferAccessibility(text, category),
    url: mapsUrl(placeId, name, address),
    imageUrl: typeof r.thumbnail === "string" ? r.thumbnail : null,
    source: "serpapi_maps",
    sourceId: placeId,
  };
}

export function mapEvent(r: Json, windows: Overlap[]): Venue | null {
  const title = norm(String(r?.title ?? ""));
  if (!title || !windows.length) return null;
  const refYear = chicagoParts(Date.parse(windows[0]!.start)).year;
  const when = parseEventWhen(r.date?.when, r.date?.start_date, refYear);
  if (!when) return null;

  const endMs = when.end ?? when.start + (when.timeKnown ? 3 : 24) * HOUR;
  const inWindow = windows.some((w) => {
    const ws = Date.parse(w.start);
    const we = Date.parse(w.end);
    return Math.min(endMs, we) - Math.max(when.start, ws) > 0;
  });
  if (!inWindow) return null;

  const addr: string[] = Array.isArray(r.address) ? r.address.map(String) : [];
  const venueName = norm(String(r.venue?.name ?? addr[0] ?? title));
  const address = norm(addr.join(", "));
  const text = `${title} ${r.description ?? ""} ${venueName}`;
  const sourceId = String(r.link ?? `${title}|${when.start}`);

  return {
    id: `v_${sha(sourceId)}`,
    kind: "event",
    name: venueName,
    category: "Event",
    address,
    area: areaFromZip(address) ?? "Austin",
    // google_events returns no coordinates; use the city centre rather than guess.
    location: { ...config.austin },
    rating: typeof r.venue?.rating === "number" ? r.venue.rating : null,
    reviewCount: typeof r.venue?.reviews === "number" ? r.venue.reviews : null,
    priceLevel: null,
    estimatedCostPerPerson: null,
    hours: null,
    event: {
      title,
      start: toChicagoISO(when.start),
      end: when.end != null ? toChicagoISO(when.end) : null,
    },
    tags: inferTags(text, false),
    dietary: [],
    accessibility: [],
    url: typeof r.link === "string" ? r.link : null,
    imageUrl: typeof r.thumbnail === "string" ? r.thumbnail : typeof r.image === "string" ? r.image : null,
    source: "serpapi_events",
    sourceId,
  };
}

// ---------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------

const quality = (v: Venue) =>
  (v.rating ?? 4) * Math.log10((v.reviewCount ?? 50) + 10);

export function createVenueSearcher(deps: SerpDeps) {
  return async function searchVenues(agg: AggregatedConstraints): Promise<Venue[]> {
    const windows = agg.windows;
    const mapQs = buildMapsQueries(agg);
    const eventQs = buildEventQueries(agg);
    const chip = dateChip(windows);
    const ll = `@${config.austin.lat},${config.austin.lng},${agg.areas[0] ? 14 : 12}z`;

    type Task = { label: string; run: () => Promise<Venue[]> };
    const tasks: Task[] = [
      ...mapQs.map<Task>((q) => ({
        label: `maps "${q}"`,
        run: async () => {
          const { data, cached } = await serpGet("google_maps", { q, type: "search", ll, hl: "en" }, deps);
          const rows: Json[] = [...(data.local_results ?? []), ...(data.place_results ? [data.place_results] : [])];
          let closed = 0;
          const venues: Venue[] = [];
          for (const r of rows) {
            const v = mapPlace(r, windows);
            if (v === "closed") closed++;
            else if (v) venues.push(v);
          }
          log.info(SCOPE, `maps "${q}": ${cached ? "cache" : "live"}, ${rows.length} results, ${closed} closed at planned time`);
          return venues;
        },
      })),
      ...eventQs.map<Task>((q) => ({
        label: `events "${q}"`,
        run: async () => {
          const { data, cached } = await serpGet(
            "google_events",
            { q, htichips: chip, hl: "en", gl: "us" },
            deps,
          );
          const rows: Json[] = data.events_results ?? [];
          const venues = rows.map((r) => mapEvent(r, windows)).filter((v): v is Venue => v !== null);
          log.info(SCOPE, `events "${q}": ${cached ? "cache" : "live"}, ${rows.length} results, ${venues.length} in window`);
          return venues;
        },
      })),
    ];

    const settled = await Promise.allSettled(tasks.map((t) => t.run()));
    const failures = settled
      .map((s, i) => (s.status === "rejected" ? { label: tasks[i]!.label, reason: s.reason as unknown } : null))
      .filter((f): f is { label: string; reason: unknown } => f !== null);
    for (const f of failures) log.warn(SCOPE, `${f.label} failed: ${errMessage(f.reason)}`);

    if (failures.length === tasks.length) {
      if (failures.every((f) => f.reason instanceof MissingKeyError)) {
        log.warn(SCOPE, "no SERPAPI_KEY and nothing cached: serving mock venues (see mock/venues.sample.json)");
        return mockVenues();
      }
      throw new AppError(
        502,
        "VENUE_SEARCH_FAILED",
        `SerpApi search failed: ${errMessage(failures[0]?.reason)}`,
      );
    }

    // Merge, dedupe, rate-filter, cap.
    const seen = new Set<string>();
    const all: Venue[] = [];
    for (const s of settled) {
      if (s.status !== "fulfilled") continue;
      for (const v of s.value) {
        const k = v.sourceId ?? v.id;
        if (seen.has(k)) continue;
        seen.add(k);
        if (v.kind === "place" && v.rating != null && v.rating < MIN_RATING) continue;
        all.push(v);
      }
    }
    const places = all.filter((v) => v.kind === "place").sort((a, b) => quality(b) - quality(a)).slice(0, MAX_PLACES);
    const events = all.filter((v) => v.kind === "event").sort((a, b) => quality(b) - quality(a)).slice(0, MAX_EVENTS);
    return [...places, ...events];
  };
}

let defaultSearcher: ReturnType<typeof createVenueSearcher> | null = null;

/** Search Austin venues + events for the aggregated constraints. Cache-first. */
export function searchVenues(agg: AggregatedConstraints): Promise<Venue[]> {
  defaultSearcher ??= createVenueSearcher({
    apiKey: config.serpapiKey,
    cache: new JsonFileCache(config.serpapiCacheFile),
    fetchFn: fetch,
  });
  return defaultSearcher(agg);
}
