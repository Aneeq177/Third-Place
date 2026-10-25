import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type {
  Constraints,
  CreateGroupRequest,
  Group,
  NoteResponse,
  Plan,
  PlanResponse,
  TextNoteRequest,
  VoteRequest,
  VoteResponse,
} from "../shared/types";
import type { AggregatedConstraints } from "./availability";
import { config } from "./config";
import { AppError, errMessage } from "./errors";
import { buildIcs } from "./ics";
import type { LlmApi } from "./llmClient";
import { log, timed } from "./log";
import { generatePlans } from "./plan";
import type { Store } from "./store";
import type { Venue } from "../shared/types";

export interface AppDeps {
  store: Store;
  llm: LlmApi;
  searchVenues: (agg: AggregatedConstraints) => Promise<Venue[]>;
}

const AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/x-m4a",
  "audio/m4a",
]);

const MAX_NAME = 60;

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

function requireName(v: unknown, field = "memberName"): string {
  if (typeof v !== "string" || !v.trim()) throw new AppError(400, "INVALID_BODY", `${field} is required`);
  const name = v.trim();
  if (name.length > MAX_NAME) throw new AppError(400, "INVALID_BODY", `${field} must be at most ${MAX_NAME} characters`);
  return name;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError(400, "INVALID_BODY", "Request body must be valid JSON");
  }
  if (!isObj(body)) throw new AppError(400, "INVALID_BODY", "Request body must be a JSON object");
  return body;
}

function checkConstraints(c: unknown): asserts c is Constraints {
  if (
    !isObj(c) ||
    !Array.isArray(c.freeWindows) ||
    !isObj(c.budgetPerPerson) ||
    !Array.isArray(c.vibe) ||
    !Array.isArray(c.dietary) ||
    !Array.isArray(c.accessibility) ||
    !Array.isArray(c.transport)
  ) {
    throw new Error("extractor returned an object that does not match the Constraints shape");
  }
}

export function createApp(deps: AppDeps) {
  const { store, llm } = deps;
  const app = new Hono();
  const inflightPlans = new Map<string, Promise<[Plan, Plan, Plan]>>();

  // CORS: open by default; CORS_ORIGIN can pin it to the frontend origin(s).
  const origins = config.corsOrigin.split(",").map((s) => s.trim()).filter(Boolean);
  app.use(
    "*",
    cors({
      origin: origins.includes("*") ? "*" : origins,
      allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      exposeHeaders: ["Content-Disposition"],
      maxAge: 86400,
    }),
  );

  app.use("*", async (c, next) => {
    const t0 = performance.now();
    await next();
    log.info("http", `${c.req.method} ${new URL(c.req.url).pathname} -> ${c.res.status} ${Math.round(performance.now() - t0)}ms`);
  });

  app.get("/api/health", (c) => c.json({ ok: true, groups: store.size() }));

  // ---- POST /api/groups -------------------------------------------------------------
  app.post("/api/groups", async (c) => {
    const body = (await readJson(c.req.raw)) as Partial<CreateGroupRequest>;
    const name = requireName(body.name, "name");
    let memberNames: string[] = [];
    if (body.memberNames !== undefined) {
      if (!Array.isArray(body.memberNames))
        throw new AppError(400, "INVALID_BODY", "memberNames must be an array of strings");
      memberNames = body.memberNames.map((n) => requireName(n, "memberNames[]"));
    }
    const group = store.create(name, memberNames);
    log.info("groups", `created ${group.id} "${group.name}" with ${group.members.length} member(s)`);
    return c.json(group satisfies Group, 201);
  });

  // ---- GET /api/groups/:id ----------------------------------------------------------
  app.get("/api/groups/:id", (c) => c.json(store.get(c.req.param("id")) satisfies Group));

  // ---- POST /api/groups/:id/notes ---------------------------------------------------
  app.post(
    "/api/groups/:id/notes",
    bodyLimit({
      maxSize: config.maxAudioBytes + 512 * 1024, // file + multipart overhead
      onError: (c) =>
        c.json(
          new AppError(400, "AUDIO_TOO_LARGE", `Upload exceeds ${config.maxAudioBytes / 1024 / 1024} MB`).toBody(),
          400,
        ),
    }),
    async (c) => {
      const group = store.get(c.req.param("id"));
      const scope = `note ${group.id}`;
      const contentType = c.req.header("content-type") ?? "";

      let memberName: string;
      let text: string | null = null;
      let audio: File | null = null;

      if (contentType.toLowerCase().startsWith("multipart/form-data")) {
        let form: FormData;
        try {
          form = await c.req.raw.formData();
        } catch {
          throw new AppError(400, "INVALID_BODY", "Could not parse multipart form data");
        }
        memberName = requireName(form.get("memberName"));
        const a = form.get("audio");
        if (a && typeof a !== "string") audio = a;
        const t = form.get("text");
        if (typeof t === "string" && t.trim()) text = t;
      } else {
        const body = (await readJson(c.req.raw)) as Partial<TextNoteRequest>;
        memberName = requireName(body.memberName);
        if (typeof body.text === "string" && body.text.trim()) text = body.text;
      }

      // 1. transcript
      let transcript: string;
      if (audio) {
        if (audio.size === 0) throw new AppError(400, "MISSING_AUDIO_OR_TEXT", "The audio file is empty");
        if (audio.size > config.maxAudioBytes)
          throw new AppError(400, "AUDIO_TOO_LARGE", `Audio must be at most ${config.maxAudioBytes / 1024 / 1024} MB`);
        const mime = (audio.type || "").split(";")[0]!.trim().toLowerCase();
        if (!AUDIO_TYPES.has(mime))
          throw new AppError(400, "INVALID_BODY", `Unsupported audio type "${audio.type || "unknown"}"`);
        const buf = Buffer.from(await audio.arrayBuffer());
        transcript = await timed(
          scope,
          `transcribe ${memberName} (${Math.round(audio.size / 1024)} KB ${mime})`,
          async () => {
            try {
              const t = await llm.transcribe(buf, mime);
              if (typeof t !== "string" || !t.trim()) throw new Error("empty transcript");
              return t.trim();
            } catch (e) {
              throw new AppError(502, "TRANSCRIBE_FAILED", `Transcription failed: ${errMessage(e)}`);
            }
          },
          (t) => `${t.length} chars`,
        );
      } else if (text) {
        if (text.length > config.maxTextChars)
          throw new AppError(400, "INVALID_BODY", `text must be at most ${config.maxTextChars} characters`);
        transcript = text.trim();
        log.info(scope, `text note from ${memberName} (${transcript.length} chars), skipping transcription`);
      } else {
        throw new AppError(400, "MISSING_AUDIO_OR_TEXT", "Send an audio file or a text note");
      }

      // 2. constraints
      const extracted = await timed(scope, `extract constraints for ${memberName}`, async () => {
        try {
          const result = await llm.extractConstraints({ memberName, text: transcript });
          checkConstraints(result);
          return result;
        } catch (e) {
          throw new AppError(502, "EXTRACT_FAILED", `Constraint extraction failed: ${errMessage(e)}`);
        }
      });

      // 3. store (server owns memberName + rawTranscript)
      const member = store.ensureMember(group, memberName);
      const constraints: Constraints = { ...extracted, memberName: member.name, rawTranscript: transcript };
      member.constraints = constraints;
      return c.json({ transcript, constraints } satisfies NoteResponse);
    },
  );

  // ---- PUT /api/groups/:id/constraints ----------------------------------------------
  app.put("/api/groups/:id/constraints", async (c) => {
    const group = store.get(c.req.param("id"));
    const body = await readJson(c.req.raw);
    const memberName = requireName(body.memberName);
    const incoming = body.constraints;
    try {
      checkConstraints(incoming);
    } catch {
      throw new AppError(400, "INVALID_BODY", "constraints must match the Constraints shape");
    }
    const member = store.ensureMember(group, memberName);
    const raw =
      typeof incoming.rawTranscript === "string" && incoming.rawTranscript.trim()
        ? incoming.rawTranscript.trim()
        : (member.constraints?.rawTranscript ?? "");
    const constraints: Constraints = { ...incoming, memberName: member.name, rawTranscript: raw };
    member.constraints = constraints;
    log.info(`note ${group.id}`, `updated constraints for ${member.name} (no re-extract)`);
    return c.json({ transcript: raw, constraints } satisfies NoteResponse);
  });

  // ---- POST /api/groups/:id/plan ----------------------------------------------------
  app.post("/api/groups/:id/plan", async (c) => {
    const group = store.get(c.req.param("id"));
    // Concurrent calls for the same group share one run.
    let run = inflightPlans.get(group.id);
    if (!run) {
      run = generatePlans(group, { llm, searchVenues: deps.searchVenues }).finally(() =>
        inflightPlans.delete(group.id),
      );
      inflightPlans.set(group.id, run);
    }
    const plans = await run;
    group.plans = plans;
    group.confirmedPlanId = null;
    group.status = "voting";
    return c.json({ plans } satisfies PlanResponse);
  });

  // ---- POST /api/groups/:id/vote ----------------------------------------------------
  app.post("/api/groups/:id/vote", async (c) => {
    const group = store.get(c.req.param("id"));
    const body = (await readJson(c.req.raw)) as Partial<VoteRequest>;
    const memberName = requireName(body.memberName);
    if (typeof body.planId !== "string" || !body.planId)
      throw new AppError(400, "INVALID_BODY", "planId is required");

    if (group.status === "confirmed")
      throw new AppError(409, "ALREADY_CONFIRMED", "This group has already confirmed a plan");
    if (group.plans.length === 0)
      throw new AppError(409, "NO_PLANS_YET", "Generate plans with POST /plan before voting");
    const plan = group.plans.find((p) => p.id === body.planId);
    if (!plan) throw new AppError(404, "PLAN_NOT_FOUND", `No plan with id ${body.planId} in this group`);

    const member = store.ensureMember(group, memberName);
    for (const p of group.plans) p.votes = p.votes.filter((v) => v.toLowerCase() !== member.name.toLowerCase());
    plan.votes.push(member.name);

    const needed = Math.floor(group.members.length / 2) + 1;
    const winner = group.plans
      .filter((p) => p.votes.length >= needed)
      .sort((a, b) => b.votes.length - a.votes.length)[0];
    if (winner) {
      group.confirmedPlanId = winner.id;
      group.status = "confirmed";
      log.info(`vote ${group.id}`, `confirmed ${winner.id} with ${winner.votes.length}/${group.members.length} votes`);
    } else {
      log.info(
        `vote ${group.id}`,
        `${member.name} -> ${plan.id}; tally ${group.plans.map((p) => `${p.id}=${p.votes.length}`).join(" ")}, need ${needed}`,
      );
    }
    return c.json({ group } satisfies VoteResponse);
  });

  // ---- GET /api/groups/:id/confirmed.ics --------------------------------------------
  app.get("/api/groups/:id/confirmed.ics", (c) => {
    const group = store.get(c.req.param("id"));
    const plan = group.confirmedPlanId ? group.plans.find((p) => p.id === group.confirmedPlanId) : undefined;
    if (!plan) throw new AppError(404, "NOT_CONFIRMED", "No plan has been confirmed for this group yet");
    return new Response(buildIcs(plan, group.id, group.name), {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="third-place.ics"',
      },
    });
  });

  app.notFound((c) =>
    c.json(new AppError(404, "NOT_FOUND", `No route for ${c.req.method} ${new URL(c.req.url).pathname}`).toBody(), 404),
  );

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(err.toBody(), err.status as ContentfulStatusCode);
    }
    log.error("http", `unhandled: ${err.stack ?? err.message}`);
    return c.json(new AppError(500, "INTERNAL", "Something went wrong on the server").toBody(), 500);
  });

  return app;
}
