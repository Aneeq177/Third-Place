# Third Place

An AI that turns "we should hang out" into a real plan. Friends leave voice notes, the AI works out when, where, and what — and the app succeeds when everyone puts their phone down.

## How it works

1. **Create a group** and share a link.
2. **Each member records** a 10–20 second voice note (typed text is a fallback).
3. **Voice is transcribed**, then structured constraints are extracted: free windows, budget, vibe, diet or accessibility, location, and transport.
4. **Nearby venues and events** are found and filtered by hours, rating, and price.
5. **The group gets 3 ranked plans** with plain-language reasons, then votes.
6. **A confirmed plan** produces a shareable invite card and an `.ics` calendar file.

## Features

- Voice or text input for availability and preferences
- Constraint extraction into a structured plan request
- Real venue and event suggestions nearby
- Ranked plans with reasons the group can vote on
- Shareable invite card and calendar download after confirmation

## Stack

- **Muse Voice Transcribe** — audio to text
- **Muse Spark** — constraint extraction
- **SerpApi** (Maps/Local, Events) — venues and events
- **Muse Image** — invite card generation

## Running the backend (`server/`)

Node 20+ and TypeScript, built on [Hono](https://hono.dev). State is in memory only; every restart re-seeds a demo group.

```bash
cp .env.example .env        # repo root; set SERPAPI_KEY if you have one (optional, see below)
cd server
npm install
npm run dev                 # watch mode; `npm start` for a plain run
```

The API listens on `http://localhost:$PORT` (default `8787`) and implements every endpoint in [`docs/api-contract.md`](docs/api-contract.md) under `/api`. CORS is open (`*`); set `CORS_ORIGIN=https://your-frontend` (comma-separated for several) to pin it.

**Demo group.** On startup the server creates group `g_demo` ("Friday crew") with Maya, Jordan and Priya's constraints from `mock/constraints.sample.json`, so you can go straight to the plan step:

```bash
curl -X POST localhost:8787/api/groups/g_demo/plan
curl -X POST localhost:8787/api/groups/g_demo/vote -H 'content-type: application/json' -d '{"planId":"p_1","memberName":"Maya"}'
curl -X POST localhost:8787/api/groups/g_demo/vote -H 'content-type: application/json' -d '{"planId":"p_1","memberName":"Priya"}'
curl -OJ localhost:8787/api/groups/g_demo/confirmed.ics
```

**Plan pipeline** (`POST /api/groups/:id/plan`), each step logged with its timing: merge constraints and find shared free windows (everyone first, otherwise the largest subset free for 1h+) → search SerpApi (Google Maps + Google Events) → `rankPlans` → exactly 3 ranked plans. Votes: a plan is confirmed once it has more than half the members' votes.

**SerpApi and the cache.** `server/serpapi.ts` is cache-first. Every successful response is stored in `server/cache/serpapi-cache.json`, keyed by engine and query, and a cached query never goes to the network. Places closed during the planned window are dropped.

- With `SERPAPI_KEY` set, a cache miss makes a live call and saves the result.
- Without a key, only cached responses are used. If nothing is cached, the server serves `mock/venues.sample.json` and logs a warning.
- To make the demo independent of live calls: set the key, run `npm run warm-cache`, and commit the cache file.

**LLM functions.** The server imports `transcribe`, `extractConstraints` and `rankPlans` from `server/llm/index.ts`. Until that exists (or for any function it doesn't export) it falls back to mock-backed stubs, and says so in the startup log.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `SERPAPI_KEY` | none | Live SerpApi calls on a cache miss |
| `SERPAPI_CACHE_FILE` | `server/cache/serpapi-cache.json` | Cache location |
| `CORS_ORIGIN` | `*` | Allowed origin(s) |

Other scripts: `npm run typecheck`, `npm test`.
