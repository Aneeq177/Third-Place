import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { aggregate, findOverlaps } from "../availability";
import { JsonFileCache } from "../cache";
import { parseEventWhen } from "../eventTime";
import { openDuring, parseDayHours } from "../hours";
import { buildIcs } from "../ics";
import { mockConstraints, mockPlans } from "../mockData";
import { buildMapsQueries, createVenueSearcher, mapEvent, mapPlace } from "../serpapi";
import { chicagoWallToMs, toChicagoISO } from "../time";

test("time: chicago wall clock round trips with the right offset", () => {
  const ms = chicagoWallToMs(2026, 10, 30, 19, 0);
  assert.equal(toChicagoISO(ms), "2026-10-30T19:00:00-05:00");
  assert.equal(toChicagoISO(chicagoWallToMs(2026, 12, 5, 19, 0)), "2026-12-05T19:00:00-06:00");
});

test("serpapi queries: coffee shop searches coffee shops, not generic restaurants", () => {
  const queries = buildMapsQueries({
    memberNames: ["Aneeq"],
    windows: [],
    budget: { min: null, max: 15 },
    dietary: [],
    accessibility: [],
    vibes: ["coffee shop"],
    areas: ["East Austin"],
    transport: [],
  });
  assert.ok(queries.some((q) => /coffee shops? in East Austin/i.test(q)), queries.join(" | "));
  assert.ok(!queries.some((q) => /^restaurants in /i.test(q)), queries.join(" | "));
});

test("overlaps: demo group is all free Friday 8-11pm", () => {
  const { windows, everyone } = findOverlaps(mockConstraints());
  assert.equal(everyone, true);
  assert.equal(windows.length, 1);
  assert.equal(windows[0]!.start, "2026-10-30T20:00:00-05:00");
  assert.equal(windows[0]!.end, "2026-10-30T23:00:00-05:00");
  assert.deepEqual(windows[0]!.attendees, ["Maya", "Jordan", "Priya"]);
});

test("overlaps: falls back to the largest subset, and flexible members don't block", () => {
  const [maya, jordan, priya] = mockConstraints();
  // Priya only free Saturday evening -> nobody shares with her; Maya+Jordan share Fri 8-11 and Sat 12-3.
  const onlySat = { ...priya!, freeWindows: priya!.freeWindows.slice(1) };
  const r = findOverlaps([maya!, jordan!, onlySat]);
  assert.equal(r.everyone, false);
  assert.deepEqual(r.windows[0]!.attendees, ["Maya", "Jordan"]);

  const flexible = { ...priya!, freeWindows: [] };
  const r2 = findOverlaps([maya!, jordan!, flexible]);
  assert.equal(r2.everyone, true);
  assert.equal(r2.windows[0]!.start, "2026-10-30T20:00:00-05:00");
});

test("aggregate: budget intersection and hard-need union", () => {
  const cs = mockConstraints();
  const agg = aggregate(cs, findOverlaps(cs).windows);
  // Floors (20, 0, 30) and ceilings (40, 20, 60) don't intersect; the tightest ceiling wins.
  assert.deepEqual(agg.budget, { min: null, max: 20 });
  assert.deepEqual([...agg.dietary].sort(), ["gluten-free", "vegetarian"]);
  assert.deepEqual(agg.accessibility, ["needs seating"]);
});

test("hours: parsing and open/closed checks", () => {
  assert.deepEqual(parseDayHours("11 AM–11 PM"), [{ s: 660, e: 1380 }]);
  assert.deepEqual(parseDayHours("5–10 PM"), [{ s: 1020, e: 1320 }]);
  assert.deepEqual(parseDayHours("11 AM\u2013 2 PM, 5\u202f–10 PM"), [
    { s: 660, e: 840 },
    { s: 1020, e: 1320 },
  ]);
  assert.deepEqual(parseDayHours("4 PM–2 AM"), [{ s: 960, e: 1560 }]);
  assert.deepEqual(parseDayHours("Closed"), []);
  assert.equal(parseDayHours("whenever"), null);

  const fri8 = Date.parse("2026-10-30T20:00:00-05:00");
  const fri11 = Date.parse("2026-10-30T23:00:00-05:00");
  assert.equal(openDuring({ friday: "4 PM–2 AM" }, fri8, fri11), "open");
  assert.equal(openDuring({ friday: "8 AM–6 PM" }, fri8, fri11), "closed");
  assert.equal(openDuring({ friday: "Closed" }, fri8, fri11), "closed");
  assert.equal(openDuring({ saturday: "Closed" }, fri8, fri11), "unknown");
  assert.equal(openDuring(undefined, fri8, fri11), "unknown");
});

test("eventTime: SerpApi 'when' strings", () => {
  const iso = (n: number | null) => (n == null ? null : toChicagoISO(n));
  let t = parseEventWhen("Fri, Oct 30, 7 – 10 PM", "Oct 30", 2026)!;
  assert.equal(iso(t.start), "2026-10-30T19:00:00-05:00");
  assert.equal(iso(t.end), "2026-10-30T22:00:00-05:00");

  t = parseEventWhen("Fri, Oct 30, 7:30 PM", "Oct 30", 2026)!;
  assert.equal(iso(t.start), "2026-10-30T19:30:00-05:00");
  assert.equal(t.end, null);

  t = parseEventWhen("Sat, Oct 31, 9 PM – Sun, Nov 1, 2 AM", "Oct 31", 2026)!;
  assert.equal(iso(t.start), "2026-10-31T21:00:00-05:00");
  assert.equal(iso(t.end), "2026-11-01T02:00:00-06:00"); // DST ended at 2 AM that morning

  t = parseEventWhen("Oct 30, 10 PM – 2 AM", undefined, 2026)!;
  assert.equal(iso(t.end), "2026-10-31T02:00:00-05:00");

  t = parseEventWhen("Oct 30 – 31", "Oct 30", 2026)!;
  assert.equal(t.timeKnown, false);
  assert.equal(iso(t.end), "2026-11-01T00:00:00-05:00");

  assert.equal(parseEventWhen("someday", undefined, 2026), null);
});

const friNight = [
  { start: "2026-10-30T20:00:00-05:00", end: "2026-10-30T23:00:00-05:00", attendees: ["Maya"] },
];

test("mapPlace: normalises a Maps result and drops closed places", () => {
  const raw = {
    title: "The Continental Club",
    place_id: "ChIJabc",
    gps_coordinates: { latitude: 30.2505, longitude: -97.7494 },
    rating: 4.7,
    reviews: 2100,
    price: "$$",
    type: "Live music venue",
    types: ["Live music venue", "Bar"],
    address: "1315 S Congress Ave, Austin, TX 78704",
    operating_hours: { friday: "4\u202fPM–2\u202fAM", saturday: "4 PM–2 AM" },
    extensions: [{ accessibility: ["Wheelchair accessible entrance"] }],
    thumbnail: "https://img",
  };
  const v = mapPlace(raw, friNight);
  assert.notEqual(v, "closed");
  assert.notEqual(v, null);
  if (v === "closed" || v === null) return;
  assert.equal(v.kind, "place");
  assert.equal(v.priceLevel, 2);
  assert.equal(v.area, "South Congress");
  assert.equal(v.sourceId, "ChIJabc");
  assert.equal(v.hours, "4 PM – 2 AM");
  assert.deepEqual(v.location, { lat: 30.2505, lng: -97.7494 });
  assert.ok(v.tags.includes("live music"));
  assert.ok(v.tags.includes("late night"));
  assert.ok(v.accessibility.includes("wheelchair accessible"));
  assert.match(v.url!, /place_id:ChIJabc/);

  assert.equal(mapPlace({ ...raw, operating_hours: { friday: "8 AM–6 PM" } }, friNight), "closed");
  assert.equal(mapPlace({ title: "No coords" }, friNight), null);
});

test("mapEvent: keeps only events overlapping the planned window", () => {
  const ev = {
    title: "Jazz Night",
    date: { start_date: "Oct 30", when: "Fri, Oct 30, 9 – 11 PM" },
    address: ["Elephant Room", "315 Congress Ave, Austin, TX 78701"],
    link: "https://events.example/jazz",
    venue: { name: "Elephant Room", rating: 4.7, reviews: 900 },
  };
  const v = mapEvent(ev, friNight)!;
  assert.equal(v.kind, "event");
  assert.equal(v.name, "Elephant Room");
  assert.equal(v.event!.title, "Jazz Night");
  assert.equal(v.event!.start, "2026-10-30T21:00:00-05:00");
  assert.equal(v.area, "Downtown");
  assert.equal(
    mapEvent({ ...ev, date: { start_date: "Oct 29", when: "Thu, Oct 29, 9 – 11 PM" } }, friNight),
    null,
  );
});

test("serpapi: caches responses on disk and never refetches", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tp-cache-"));
  const file = path.join(dir, "cache.json");
  let calls = 0;
  const fetchFn = (async (url: URL) => {
    calls++;
    const engine = url.searchParams.get("engine");
    const body =
      engine === "google_maps"
        ? {
            local_results: [
              {
                title: "Bouldin Creek Cafe",
                place_id: "p1",
                gps_coordinates: { latitude: 30.2482, longitude: -97.7552 },
                rating: 4.6,
                reviews: 2900,
                price: "$",
                type: "Vegetarian restaurant",
                address: "1900 S 1st St, Austin, TX 78704",
                operating_hours: { friday: "8 AM–10 PM" },
              },
            ],
          }
        : { events_results: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;

  const cs = mockConstraints();
  const agg = aggregate(cs, findOverlaps(cs).windows);

  const search1 = createVenueSearcher({ apiKey: "k", cache: new JsonFileCache(file), fetchFn });
  const first = await search1(agg);
  assert.ok(first.some((v) => v.name === "Bouldin Creek Cafe"));
  assert.ok(calls > 0);
  const after = calls;

  // Fresh process: cache loaded from disk, no key, no network.
  const search2 = createVenueSearcher({ apiKey: "", cache: new JsonFileCache(file), fetchFn });
  const second = await search2(agg);
  assert.equal(calls, after);
  assert.deepEqual(
    second.map((v) => v.id),
    first.map((v) => v.id),
  );
});

test("ics: one VEVENT with the plan's times and details", () => {
  const plan = mockPlans()[0]!;
  const ics = buildIcs(plan, "g_x", "Friday crew");
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.includes("DTSTART:20261031T010000Z\r\n"));
  assert.ok(ics.includes("DTEND:20261031T040000Z\r\n"));
  assert.ok(ics.includes("LOCATION:Bouldin Creek Cafe\\, 1900 S 1st St\\, Austin\\, TX 78704"));
  assert.equal(ics.match(/BEGIN:VEVENT/g)!.length, 1);
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
});
