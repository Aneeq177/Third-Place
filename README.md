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
