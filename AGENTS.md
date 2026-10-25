# AGENTS.md

Rules for every agent (and human) working in this repo. Read this before touching anything.

## What we're building

**Third Place** (24-hour hackathon). Friends each leave a 10–20 second voice note (or typed text) about when/where/what they want to do. The backend transcribes it, extracts structured constraints per person, finds real Austin venues/events via SerpApi, and returns 3 ranked plans with plain-language reasons. The group votes; a confirmed plan gives a shareable card and an `.ics` file.

## Layout

| Path      | What lives there                                   |
|-----------|----------------------------------------------------|
| `src/`    | Lovable frontend (React + TypeScript + Vite)       |
| `server/` | Node + TypeScript backend                          |
| `shared/` | Types and JSON Schema shared by frontend + backend |
| `mock/`   | Sample data in our shapes (for building without keys) |
| `docs/`   | The API contract                                   |

## Ownership

Only edit paths you own. If you need a change elsewhere, ask the owner (or leave a note in your PR/commit) instead of editing it.

| Owner        | Owns                                             |
|--------------|--------------------------------------------------|
| Lovable      | `src/`                                           |
| Cursor       | `server/` **except** `server/llm/`               |
| Claude Code  | `shared/`, `mock/`, `docs/`, `server/llm/`       |

`shared/types.ts`, `shared/constraints.schema.json` and `docs/api-contract.md` are the contract. Don't drift from them; if the contract needs to change, change it first (Claude Code), then update code.

## Workflow

- Always `git pull --rebase` before starting work.
- Commit small and often, with clear messages. Push soon after committing so others rebase onto it.
- Never commit `.env` (or any `.env.*` other than `.env.example`).
- Never hardcode API keys, anywhere. Read them from environment variables.
- API keys stay server-side. The frontend only knows `VITE_API_URL`; anything prefixed `VITE_` ships to the browser, so never put a secret in one.
- Build against `mock/` until the real endpoint exists.
