# Third Place API contract

Source of truth for frontend (`src/`) and backend (`server/`). Types live in [`shared/types.ts`](../shared/types.ts); the extraction schema is [`shared/constraints.schema.json`](../shared/constraints.schema.json). Sample payloads are in [`mock/`](../mock/).

## Conventions

- **Base URL:** `VITE_API_URL` on the frontend (e.g. `http://localhost:8787`). All paths start with `/api`.
- **Format:** JSON request and response bodies, except audio upload (multipart) and the `.ics` download.
- **Times:** ISO 8601 with UTC offset, in `America/Chicago` (Austin). Example: `2026-10-30T19:00:00-05:00`.
- **Money:** USD, per person.
- **Member identity:** there are no accounts. A member is identified by `memberName` within a group (case-insensitive match, stored as first submitted).
- **CORS:** the server allows the frontend origin.
- **Secrets:** all API keys (Muse, Gemini, SerpApi) are used only by the server. The frontend never calls those services directly.

### Errors

Any non-2xx response has this body (`ApiError`):

```json
{ "error": { "code": "GROUP_NOT_FOUND", "message": "No group with id g_abc123" } }
```

| Status | `code` examples                                         |
|--------|---------------------------------------------------------|
| 400    | `INVALID_BODY`, `MISSING_AUDIO_OR_TEXT`, `AUDIO_TOO_LARGE` |
| 404    | `GROUP_NOT_FOUND`, `PLAN_NOT_FOUND`, `NOT_CONFIRMED`    |
| 409    | `NOT_ENOUGH_NOTES`, `NO_PLANS_YET`                      |
| 502    | `TRANSCRIBE_FAILED`, `EXTRACT_FAILED`, `VENUE_SEARCH_FAILED` |

## Group lifecycle

```
collecting  --POST /plan-->  voting  --majority vote-->  confirmed
```

- `collecting`: members submit notes.
- `voting`: 3 plans exist. Calling `POST /plan` again regenerates plans and clears votes.
- `confirmed`: a plan has votes from more than half of the group's members. `confirmedPlanId` is set. Votes after this are rejected with 409.

---

## POST /api/groups

Create a group.

**Request** (`CreateGroupRequest`)

```json
{ "name": "Friday crew", "memberNames": ["Maya", "Jordan", "Priya"] }
```

`memberNames` is optional; members are also added automatically the first time they submit a note.

**Response** `201` — `Group`

```json
{
  "id": "g_7f3k2p",
  "name": "Friday crew",
  "city": "Austin, TX",
  "createdAt": "2026-10-24T15:00:00-05:00",
  "status": "collecting",
  "members": [
    { "name": "Maya", "joinedAt": "2026-10-24T15:00:00-05:00", "constraints": null }
  ],
  "plans": [],
  "confirmedPlanId": null
}
```

The share link is built by the frontend from `id` (e.g. `/g/g_7f3k2p`).

## GET /api/groups/:id

**Response** `200` — `Group` (same shape as above, with current members, constraints, plans and votes). The frontend can poll this every few seconds to show who has submitted and live vote counts.

`404 GROUP_NOT_FOUND` if the id is unknown.

## POST /api/groups/:id/notes

Submit one member's voice note **or** typed text. Submitting again for the same member replaces their constraints.

**Option A — audio:** `multipart/form-data`

| Field        | Type   | Notes                                                   |
|--------------|--------|---------------------------------------------------------|
| `memberName` | text   | required                                                |
| `audio`      | file   | required; `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg` or `audio/wav`; max 5 MB (~20 s) |

**Option B — text:** `application/json` (`TextNoteRequest`)

```json
{ "memberName": "Priya", "text": "Friday after 7 works, nothing too loud, I need somewhere to sit..." }
```

**Server behavior**

1. Audio is transcribed with `TRANSCRIBE_PROVIDER` (`muse` or `gemini`). Text skips this step.
2. Constraints are extracted with a structured-output call constrained by `shared/constraints.schema.json`. The prompt includes the current date and `America/Chicago` timezone so relative days ("Friday night") resolve correctly.
3. `memberName` and `rawTranscript` are set by the server, not trusted from the model.
4. The member's `constraints` on the group are replaced.

**Response** `200` — `NoteResponse`

```json
{
  "transcript": "Friday after 7 works for me...",
  "constraints": { "memberName": "Priya", "freeWindows": [ ... ], "...": "see mock/constraints.sample.json" }
}
```

Errors: `400 MISSING_AUDIO_OR_TEXT`, `400 AUDIO_TOO_LARGE`, `502 TRANSCRIBE_FAILED`, `502 EXTRACT_FAILED`.

## POST /api/groups/:id/plan

Generate 3 ranked plans from all submitted constraints. No request body.

**Server behavior**

1. Merge constraints: overlapping free windows, budget intersection, union of dietary/accessibility needs (hard), vibe/area (soft).
2. Search Austin venues and events via SerpApi (Google Maps/Local + Google Events), normalize into `Venue`.
3. Filter by open hours in the window, rating, price, and hard needs; rank; build 3 plans with 1–2 stops each.
4. Write `why` (and `tradeoffs`) as short plain-language reasons that reference real members and real venue facts. No reason may claim something the venue data doesn't support.
5. Store plans on the group, clear old votes, set `status: "voting"`.

**Response** `200` — `PlanResponse`

```json
{ "plans": [ { "id": "p_1", "rank": 1, "...": "..." }, { "rank": 2 }, { "rank": 3 } ] }
```

Always exactly 3 plans, sorted by `rank` (1 = best). Full example: `mock/plans.sample.json`.

Errors: `409 NOT_ENOUGH_NOTES` (fewer than 2 members have constraints), `502 VENUE_SEARCH_FAILED`.

## POST /api/groups/:id/vote

**Request** (`VoteRequest`)

```json
{ "planId": "p_1", "memberName": "Maya" }
```

One vote per member. Voting again moves the vote to the new plan. Unknown `memberName`s are added to the group as members.

When a plan's votes exceed half of `members.length`, the server sets `confirmedPlanId` and `status: "confirmed"`.

**Response** `200` — `VoteResponse`

```json
{ "group": { "id": "g_7f3k2p", "status": "confirmed", "confirmedPlanId": "p_1", "...": "..." } }
```

Errors: `404 PLAN_NOT_FOUND`, `409 NO_PLANS_YET`, `409 ALREADY_CONFIRMED`.

When `status` is `confirmed`, the frontend shows the shareable card using the confirmed plan from `group.plans`.

## GET /api/groups/:id/confirmed.ics

Download the confirmed plan as a calendar file.

**Response** `200`

```
Content-Type: text/calendar; charset=utf-8
Content-Disposition: attachment; filename="third-place.ics"
```

One `VEVENT` spanning plan `start`–`end`. `SUMMARY` = plan title, `LOCATION` = first stop's name and address, `DESCRIPTION` = stops with times plus the `why` list. Times in UTC (`...Z`) or with `TZID=America/Chicago`.

`404 NOT_CONFIRMED` if no plan is confirmed yet.
