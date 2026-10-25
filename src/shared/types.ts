// Shared contract between src/ (frontend) and server/ (backend).
// Owned by Claude Code. Change docs/api-contract.md alongside any edit here.
//
// All timestamps are ISO 8601 strings with an explicit UTC offset,
// e.g. "2026-10-30T19:00:00-05:00" (Austin is America/Chicago).

export interface TimeWindow {
  start: string;
  end: string;
}

export type Transport = "walk" | "bike" | "transit" | "rideshare" | "drive";

/** What one member wants, extracted from their voice note or text.
 *  Mirrors shared/constraints.schema.json exactly. */
export interface Constraints {
  memberName: string;
  freeWindows: TimeWindow[];
  /** USD per person. null = not mentioned. */
  budgetPerPerson: { min: number | null; max: number | null };
  /** Lowercase tags, e.g. "live music", "outdoors", "chill", "cozy". */
  vibe: string[];
  /** Lowercase tags, e.g. "vegetarian", "gluten-free", "halal". */
  dietary: string[];
  /** Lowercase tags, e.g. "wheelchair accessible", "needs seating". */
  accessibility: string[];
  /** Neighborhood or area in Austin, e.g. "East Austin". "" = no preference. */
  area: string;
  transport: Transport[];
  rawTranscript: string;
}

export interface Member {
  name: string;
  joinedAt: string;
  /** null until the member submits a note. */
  constraints: Constraints | null;
}

/** A place or event, normalized from SerpApi into our shape. */
export interface Venue {
  id: string;
  kind: "place" | "event";
  name: string;
  /** e.g. "Live music venue", "Vegetarian restaurant", "Park". */
  category: string;
  address: string;
  /** Neighborhood, e.g. "South Congress". */
  area: string;
  location: { lat: number; lng: number };
  rating: number | null;
  reviewCount: number | null;
  /** 1–4, i.e. $ to $$$$. */
  priceLevel: 1 | 2 | 3 | 4 | null;
  /** USD per person, our estimate. */
  estimatedCostPerPerson: { min: number; max: number } | null;
  /** Human-readable hours for the relevant day, e.g. "11 AM – 11 PM". */
  hours: string | null;
  /** Present when kind === "event". */
  event: { title: string; start: string; end: string | null } | null;
  /** Lowercase vibe tags, same vocabulary as Constraints.vibe. */
  tags: string[];
  /** Lowercase dietary tags the venue supports. */
  dietary: string[];
  /** Lowercase accessibility tags the venue supports. */
  accessibility: string[];
  url: string | null;
  imageUrl: string | null;
  source: "serpapi_maps" | "serpapi_events" | "mock";
  /** SerpApi place_id / event link, for dedupe. */
  sourceId: string | null;
}

export interface PlanStop {
  venue: Venue;
  start: string;
  end: string;
  /** Short, e.g. "Dinner", "Live music". */
  activity: string;
}

export interface Plan {
  id: string;
  rank: 1 | 2 | 3;
  title: string;
  /** One sentence. */
  summary: string;
  start: string;
  end: string;
  stops: PlanStop[];
  estimatedCostPerPerson: { min: number; max: number };
  /** 0–100, higher is better. */
  score: number;
  /** Short plain-language reasons, e.g. "Everyone is free Friday 8–10pm". */
  why: string[];
  /** Short plain-language downsides, e.g. "Standing room only". */
  tradeoffs: string[];
  /** Member names who voted for this plan. */
  votes: string[];
}

export type GroupStatus = "collecting" | "voting" | "confirmed";

export interface Group {
  id: string;
  name: string;
  city: string;
  createdAt: string;
  status: GroupStatus;
  members: Member[];
  /** Empty until POST /plan. */
  plans: Plan[];
  confirmedPlanId: string | null;
}

// ---- Request / response bodies (see docs/api-contract.md) ----

export interface CreateGroupRequest {
  name: string;
  memberNames?: string[];
}

export interface TextNoteRequest {
  memberName: string;
  text: string;
}

/** Save edited preferences without re-running extraction. */
export interface UpdateConstraintsRequest {
  memberName: string;
  constraints: Constraints;
}

export interface NoteResponse {
  transcript: string;
  constraints: Constraints;
}

export interface PlanResponse {
  plans: [Plan, Plan, Plan];
}

export interface VoteRequest {
  planId: string;
  memberName: string;
}

export interface VoteResponse {
  group: Group;
}

export interface ApiError {
  error: { code: string; message: string };
}
