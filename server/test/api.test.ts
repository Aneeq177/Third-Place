import assert from "node:assert/strict";
import { test } from "node:test";
import type { Group, NoteResponse, PlanResponse, VoteResponse } from "../../shared/types";
import { createApp } from "../app";
import { AppError } from "../errors";
import { stubLlm } from "../llmClient";
import { mockVenues } from "../mockData";
import { DEMO_GROUP_ID, Store } from "../store";

function setup(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  const store = new Store();
  store.seedDemo();
  const app = createApp({
    store,
    llm: stubLlm,
    searchVenues: async () => mockVenues(),
    ...overrides,
  });
  const json = (method: string, url: string, body?: unknown) =>
    app.request(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { app, store, json };
}

test("create + get group, case-insensitive members", async () => {
  const { json } = setup();
  const res = await json("POST", "/api/groups", { name: "Test", memberNames: ["Ann", "ann", "Bo"] });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  const g = (await res.json()) as Group;
  assert.match(g.id, /^g_[a-z0-9]{6}$/);
  assert.deepEqual(g.members.map((m) => m.name), ["Ann", "Bo"]);
  assert.equal(g.status, "collecting");

  const got = await json("GET", `/api/groups/${g.id}`);
  assert.equal(got.status, 200);

  const bad = await json("POST", "/api/groups", { name: "" });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as any).error.code, "INVALID_BODY");

  const missing = await json("GET", "/api/groups/g_nope");
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: { code: "GROUP_NOT_FOUND", message: "No group with id g_nope" } });
});

test("demo group is seeded with three members' constraints", async () => {
  const { json } = setup();
  const g = (await (await json("GET", `/api/groups/${DEMO_GROUP_ID}`)).json()) as Group;
  assert.deepEqual(g.members.map((m) => m.name), ["Maya", "Jordan", "Priya"]);
  assert.ok(g.members.every((m) => m.constraints));
});

test("text note replaces constraints; server owns memberName + rawTranscript", async () => {
  const { json, store } = setup({
    llm: {
      ...stubLlm,
      extractConstraints: async () => ({
        ...(await stubLlm.extractConstraints({ memberName: "Maya", text: "" })),
        memberName: "WRONG",
        rawTranscript: "WRONG",
      }),
    },
  });
  const res = await json("POST", `/api/groups/${DEMO_GROUP_ID}/notes`, { memberName: "maya", text: "Friday works" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as NoteResponse;
  assert.equal(body.transcript, "Friday works");
  assert.equal(body.constraints.memberName, "Maya");
  assert.equal(body.constraints.rawTranscript, "Friday works");
  assert.equal(store.get(DEMO_GROUP_ID).members.length, 3);

  const empty = await json("POST", `/api/groups/${DEMO_GROUP_ID}/notes`, { memberName: "Maya" });
  assert.equal(empty.status, 400);
  assert.equal(((await empty.json()) as any).error.code, "MISSING_AUDIO_OR_TEXT");
});

test("audio note: multipart upload is transcribed, bad type and size are rejected", async () => {
  let seen: { bytes: number; mime: string } | null = null;
  const { app } = setup({
    llm: {
      ...stubLlm,
      transcribe: async (buf, mime) => {
        seen = { bytes: buf.length, mime };
        return "I like jazz";
      },
    },
  });
  const post = (file: File) => {
    const fd = new FormData();
    fd.set("memberName", "Zed");
    fd.set("audio", file);
    return app.request(`/api/groups/${DEMO_GROUP_ID}/notes`, { method: "POST", body: fd });
  };

  const ok = await post(new File([new Uint8Array(2048)], "n.webm", { type: "audio/webm;codecs=opus" }));
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as NoteResponse).transcript, "I like jazz");
  assert.deepEqual(seen, { bytes: 2048, mime: "audio/webm" });

  const wrongType = await post(new File([new Uint8Array(10)], "n.txt", { type: "text/plain" }));
  assert.equal(wrongType.status, 400);

  const big = await post(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "n.webm", { type: "audio/webm" }));
  assert.equal(big.status, 400);
  assert.equal(((await big.json()) as any).error.code, "AUDIO_TOO_LARGE");
});

test("upstream failures map to 502 codes", async () => {
  const { json, app } = setup({
    llm: {
      ...stubLlm,
      transcribe: async () => {
        throw new Error("boom");
      },
      extractConstraints: async () => {
        throw new Error("nope");
      },
    },
  });
  const fd = new FormData();
  fd.set("memberName", "Zed");
  fd.set("audio", new File([new Uint8Array(10)], "n.wav", { type: "audio/wav" }));
  const t = await app.request(`/api/groups/${DEMO_GROUP_ID}/notes`, { method: "POST", body: fd });
  assert.equal(t.status, 502);
  assert.equal(((await t.json()) as any).error.code, "TRANSCRIBE_FAILED");

  const e = await json("POST", `/api/groups/${DEMO_GROUP_ID}/notes`, { memberName: "Zed", text: "hi" });
  assert.equal(e.status, 502);
  assert.equal(((await e.json()) as any).error.code, "EXTRACT_FAILED");
});

test("plan needs 2 notes; then plan -> vote -> confirm -> ics", async () => {
  const { json } = setup();

  const solo = (await (await json("POST", "/api/groups", { name: "Solo" })).json()) as Group;
  await json("POST", `/api/groups/${solo.id}/notes`, { memberName: "Maya", text: "hi" });
  const notEnough = await json("POST", `/api/groups/${solo.id}/plan`);
  assert.equal(notEnough.status, 409);
  assert.equal(((await notEnough.json()) as any).error.code, "NOT_ENOUGH_NOTES");

  const id = DEMO_GROUP_ID;
  assert.equal((await json("POST", `/api/groups/${id}/vote`, { planId: "p_1", memberName: "Maya" })).status, 409);
  assert.equal((await json("GET", `/api/groups/${id}/confirmed.ics`)).status, 404);

  const planRes = await json("POST", `/api/groups/${id}/plan`);
  assert.equal(planRes.status, 200);
  const { plans } = (await planRes.json()) as PlanResponse;
  assert.equal(plans.length, 3);
  assert.deepEqual(plans.map((p) => p.rank), [1, 2, 3]);
  assert.ok(plans.every((p) => p.votes.length === 0));
  assert.equal(((await (await json("GET", `/api/groups/${id}`)).json()) as Group).status, "voting");

  const [p1, p2] = plans;
  const unknown = await json("POST", `/api/groups/${id}/vote`, { planId: "p_zzz", memberName: "Maya" });
  assert.equal(unknown.status, 404);

  // 3 members -> need 2 votes. Maya votes p1, then moves to p2.
  let v = (await (await json("POST", `/api/groups/${id}/vote`, { planId: p1!.id, memberName: "Maya" })).json()) as VoteResponse;
  assert.deepEqual(v.group.plans[0]!.votes, ["Maya"]);
  v = (await (await json("POST", `/api/groups/${id}/vote`, { planId: p2!.id, memberName: "maya" })).json()) as VoteResponse;
  assert.deepEqual(v.group.plans[0]!.votes, []);
  assert.deepEqual(v.group.plans[1]!.votes, ["Maya"]);
  assert.equal(v.group.status, "voting");

  v = (await (await json("POST", `/api/groups/${id}/vote`, { planId: p2!.id, memberName: "Jordan" })).json()) as VoteResponse;
  assert.equal(v.group.status, "confirmed");
  assert.equal(v.group.confirmedPlanId, p2!.id);

  const late = await json("POST", `/api/groups/${id}/vote`, { planId: p1!.id, memberName: "Priya" });
  assert.equal(late.status, 409);
  assert.equal(((await late.json()) as any).error.code, "ALREADY_CONFIRMED");

  const ics = await json("GET", `/api/groups/${id}/confirmed.ics`);
  assert.equal(ics.status, 200);
  assert.equal(ics.headers.get("content-type"), "text/calendar; charset=utf-8");
  assert.equal(ics.headers.get("content-disposition"), 'attachment; filename="third-place.ics"');
  const text = await ics.text();
  assert.ok(text.includes(`SUMMARY:${p2!.title.replace(/,/g, "\\,")}`));
});

test("regenerating plans clears votes and confirmation", async () => {
  const { json } = setup();
  const id = DEMO_GROUP_ID;
  const { plans } = (await (await json("POST", `/api/groups/${id}/plan`)).json()) as PlanResponse;
  await json("POST", `/api/groups/${id}/vote`, { planId: plans[0]!.id, memberName: "Maya" });
  await json("POST", `/api/groups/${id}/vote`, { planId: plans[0]!.id, memberName: "Jordan" });
  await json("POST", `/api/groups/${id}/plan`);
  const g = (await (await json("GET", `/api/groups/${id}`)).json()) as Group;
  assert.equal(g.status, "voting");
  assert.equal(g.confirmedPlanId, null);
  assert.ok(g.plans.every((p) => p.votes.length === 0));
});

test("venue search failure surfaces as 502 and leaves the group untouched", async () => {
  const { json } = setup({
    searchVenues: async () => {
      throw new AppError(502, "VENUE_SEARCH_FAILED", "SerpApi down");
    },
  });
  const res = await json("POST", `/api/groups/${DEMO_GROUP_ID}/plan`);
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: { code: "VENUE_SEARCH_FAILED", message: "SerpApi down" } });
  const g = (await (await json("GET", `/api/groups/${DEMO_GROUP_ID}`)).json()) as Group;
  assert.equal(g.status, "collecting");
  assert.equal(g.plans.length, 0);
});

test("unexpected errors become a JSON 500", async () => {
  const { json } = setup({
    searchVenues: async () => {
      throw new Error("kaboom");
    },
  });
  const res = await json("POST", `/api/groups/${DEMO_GROUP_ID}/plan`);
  assert.equal(res.status, 500);
  assert.equal(((await res.json()) as any).error.code, "INTERNAL");
});

test("unknown route returns JSON 404", async () => {
  const { json } = setup();
  const res = await json("GET", "/api/nope");
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as any).error.code, "NOT_FOUND");
});
