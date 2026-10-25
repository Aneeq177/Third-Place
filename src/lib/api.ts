// Single API client for Third Place. Contract: src/shared/types.ts + docs/api-contract.md.
// USE_MOCK (default true) serves data from src/mock/*.json via a browser-local store.
import type {
  ApiError,
  Constraints,
  CreateGroupRequest,
  Group,
  NoteResponse,
  Plan,
  PlanResponse,
  VoteResponse,
} from "@/shared/types";
import mockPlans from "@/mock/plans.sample.json";
import mockConstraints from "@/mock/constraints.sample.json";

const API_URL = (import.meta.env["VITE_API_URL"] as string | undefined) ?? "http://localhost:8787";
export const USE_MOCK = (import.meta.env["VITE_USE_MOCK"] as string | undefined) !== "false";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) {
    let body: ApiError | null = null;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      /* ignore */
    }
    throw new ApiRequestError(
      res.status,
      body?.error.code ?? "UNKNOWN",
      body?.error.message ?? `Request failed (${res.status})`,
    );
  }
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// ---------------- Mock store ----------------
const STORE_KEY = "thirdplace.mock.groups";
const nowIso = () => new Date().toISOString();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function load(): Record<string, Group> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function save(all: Record<string, Group>) {
  localStorage.setItem(STORE_KEY, JSON.stringify(all));
}
function getMock(id: string): Group {
  const g = load()[id];
  if (!g) throw new ApiRequestError(404, "GROUP_NOT_FOUND", `No group with id ${id}`);
  return g;
}
function putMock(g: Group) {
  const all = load();
  all[g.id] = g;
  save(all);
  return g;
}
function findOrAddMember(g: Group, name: string) {
  let m = g.members.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!m) {
    m = { name, joinedAt: nowIso(), constraints: null };
    g.members.push(m);
  }
  return m;
}

const mock = {
  async createGroup(req: CreateGroupRequest): Promise<Group> {
    await delay(300);
    const id = "g_" + Math.random().toString(36).slice(2, 8);
    return putMock({
      id,
      name: req.name,
      city: "Austin, TX",
      createdAt: nowIso(),
      status: "collecting",
      members: (req.memberNames ?? []).map((name) => ({ name, joinedAt: nowIso(), constraints: null })),
      plans: [],
      confirmedPlanId: null,
    });
  },
  async getGroup(id: string): Promise<Group> {
    await delay(150);
    return getMock(id);
  },
  async submitNote(id: string, memberName: string, input: { text?: string; audio?: Blob }): Promise<NoteResponse> {
    await delay(1400);
    if (!input.text && !input.audio) throw new ApiRequestError(400, "MISSING_AUDIO_OR_TEXT", "Say or type something!");
    const g = getMock(id);
    const m = findOrAddMember(g, memberName);
    const samples = mockConstraints as Constraints[];
    const base =
      samples.find((c) => c.memberName.toLowerCase() === memberName.toLowerCase()) ??
      samples[g.members.indexOf(m) % samples.length]!;
    const transcript = input.text ?? base.rawTranscript;
    const constraints: Constraints = { ...base, memberName: m.name, rawTranscript: transcript };
    m.constraints = constraints;
    putMock(g);
    return { transcript, constraints };
  },
  async generatePlans(id: string): Promise<PlanResponse> {
    await delay(2200);
    const g = getMock(id);
    if (g.members.filter((m) => m.constraints).length < 2)
      throw new ApiRequestError(409, "NOT_ENOUGH_NOTES", "Need at least 2 voice notes first");
    g.plans = (mockPlans as Plan[]).map((p) => ({ ...p, votes: [] }));
    g.status = "voting";
    g.confirmedPlanId = null;
    putMock(g);
    return { plans: g.plans as PlanResponse["plans"] };
  },
  async vote(id: string, planId: string, memberName: string): Promise<VoteResponse> {
    await delay(250);
    const g = getMock(id);
    if (!g.plans.length) throw new ApiRequestError(409, "NO_PLANS_YET", "No plans yet");
    if (g.status === "confirmed") throw new ApiRequestError(409, "ALREADY_CONFIRMED", "Already decided!");
    const plan = g.plans.find((p) => p.id === planId);
    if (!plan) throw new ApiRequestError(404, "PLAN_NOT_FOUND", "Plan not found");
    const m = findOrAddMember(g, memberName);
    g.plans.forEach((p) => (p.votes = p.votes.filter((v) => v.toLowerCase() !== m.name.toLowerCase())));
    plan.votes.push(m.name);
    if (plan.votes.length > g.members.length / 2) {
      g.status = "confirmed";
      g.confirmedPlanId = plan.id;
    }
    putMock(g);
    return { group: g };
  },
};

function toIcsDate(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
export function buildIcs(plan: Plan): string {
  const first = plan.stops[0]?.venue;
  const desc = [
    ...plan.stops.map((s) => `${s.activity}: ${s.venue.name}`),
    "",
    ...plan.why.map((w) => `• ${w}`),
  ].join("\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Third Place//EN",
    "BEGIN:VEVENT",
    `UID:${plan.id}@thirdplace`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `DTSTART:${toIcsDate(plan.start)}`,
    `DTEND:${toIcsDate(plan.end)}`,
    `SUMMARY:${plan.title}`,
    first ? `LOCATION:${first.name}\\, ${first.address.replace(/,/g, "\\,")}` : "",
    `DESCRIPTION:${desc}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

// ---------------- Public client ----------------
export const api = {
  createGroup: (req: CreateGroupRequest) =>
    USE_MOCK ? mock.createGroup(req) : request<Group>("/api/groups", json(req)),
  getGroup: (id: string) => (USE_MOCK ? mock.getGroup(id) : request<Group>(`/api/groups/${id}`)),
  submitTextNote: (id: string, memberName: string, text: string) =>
    USE_MOCK
      ? mock.submitNote(id, memberName, { text })
      : request<NoteResponse>(`/api/groups/${id}/notes`, json({ memberName, text })),
  submitAudioNote: (id: string, memberName: string, audio: Blob) => {
    if (USE_MOCK) return mock.submitNote(id, memberName, { audio });
    const fd = new FormData();
    fd.append("memberName", memberName);
    fd.append("audio", audio, `note.${audio.type.includes("mp4") ? "mp4" : "webm"}`);
    return request<NoteResponse>(`/api/groups/${id}/notes`, { method: "POST", body: fd });
  },
  generatePlans: (id: string) =>
    USE_MOCK ? mock.generatePlans(id) : request<PlanResponse>(`/api/groups/${id}/plan`, { method: "POST" }),
  vote: (id: string, planId: string, memberName: string) =>
    USE_MOCK
      ? mock.vote(id, planId, memberName)
      : request<VoteResponse>(`/api/groups/${id}/vote`, json({ planId, memberName })),
  /** Download the confirmed plan's .ics. Mock mode builds it locally. */
  async downloadIcs(group: Group) {
    let blob: Blob;
    if (USE_MOCK) {
      const plan = group.plans.find((p) => p.id === group.confirmedPlanId);
      if (!plan) throw new ApiRequestError(404, "NOT_CONFIRMED", "Nothing confirmed yet");
      blob = new Blob([buildIcs(plan)], { type: "text/calendar" });
    } else {
      window.location.href = `${API_URL}/api/groups/${group.id}/confirmed.ics`;
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "third-place.ics";
    a.click();
    URL.revokeObjectURL(url);
  },
};

export function errorMessage(e: unknown) {
  if (e instanceof ApiRequestError) {
    const friendly: Record<string, string> = {
      NOT_ENOUGH_NOTES: "Need at least 2 friends' notes before the robot can plan. Go poke someone!",
      GROUP_NOT_FOUND: "Hmm, this hangout doesn't exist. Maybe a typo in the link?",
      TRANSCRIBE_FAILED: "Couldn't make out that note. Try again, or just type it.",
      AUDIO_TOO_LARGE: "That note's a bit long. Keep it under 20 seconds!",
      ALREADY_CONFIRMED: "It's already decided! Go get ready.",
    };
    return friendly[e.code] ?? e.message;
  }
  return e instanceof Error ? e.message : "Something went sideways.";
}
