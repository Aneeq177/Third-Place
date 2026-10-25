// All prompts live here as named constants. Keep them free of secrets.

export const EXTRACT_SYSTEM = `You extract one friend's hangout constraints from a short voice-note transcript or typed message, for a group planning an outing in Austin, Texas.

Return ONLY a JSON object that matches the provided schema. No prose, no markdown.

Rules:
- Only record what the person actually said. Never invent preferences.
- dietary and accessibility: include an item ONLY if the person explicitly stated that need. If they did not mention it, return an empty array. Never guess, never infer from the name or the vibe.
- Tags (vibe, dietary, accessibility) are short and lowercase, e.g. "live music", "outdoors", "vegetarian", "needs seating".
- transport: only values from the schema enum, only if mentioned ("I'll bike" -> ["bike"], "no car" alone -> ["transit","rideshare"]).
- area: the Austin neighborhood they named (e.g. "East Austin", "Zilker"). Empty string if none.
- memberName and rawTranscript will be overwritten by the server; copy them from the input.

Time handling (all times in America/Chicago, ISO 8601 with offset, end strictly after start):
- Resolve relative days against the reference date the user message gives you. A bare weekday means its NEXT occurrence after the reference date (the reference date itself only if they say "today" or "tonight").
- Vague times get sensible defaults:
  - "anytime" / "all day" / "whenever" on a day -> 10:00 to 22:00
  - "morning" -> 09:00 to 12:00; "afternoon" -> 12:00 to 17:00; "evening" -> 17:00 to 21:00; "night" / "late" -> 20:00 to 24:00 (end at 00:00 the next day)
  - "after 7" -> 19:00 to 23:00; "until 6" / "before 6" -> 10:00 to 18:00; "lunch" -> 11:30 to 14:00; "dinner" -> 18:00 to 21:00
  - "weekend" -> both Saturday and Sunday windows (10:00 to 22:00)
- If no day or time is mentioned at all, return an empty freeWindows array. Do not make one up.

Budget handling (USD per person; use null for an unstated bound):
- Explicit numbers win ("20 to 40 bucks" -> min 20, max 40; "under $30" -> min null, max 30).
- "cheap", "broke", "budget", "nothing expensive" with no number -> min null, max 20.
- "free" -> min 0, max 0. "treat ourselves", "fancy", "splurge" with no number -> min 40, max null.
- Nothing said about money -> min null, max null.`;

export const EXTRACT_USER = (p: { memberName: string; text: string; referenceDate: string; weekday: string }) =>
  `Reference date: ${p.referenceDate} (${p.weekday}), timezone America/Chicago.
memberName: ${JSON.stringify(p.memberName)}

Transcript:
"""
${p.text}
"""`;

export const EXTRACT_RETRY = (error: string) =>
  `Your previous answer was not valid. Problem: ${error}
Return ONLY a corrected JSON object that matches the schema exactly.`;

export const TRANSCRIBE_GEMINI = `Transcribe this audio verbatim. It is a short voice note about plans to hang out with friends. Return only the transcript text, with no commentary, timestamps or speaker labels. If it is silent or unintelligible, return an empty string.`;

export const RANK_SYSTEM = `You build 3 ranked hangout plans for a group of friends in Austin, Texas, and explain them honestly in plain language.

You are given:
- members: each person's stated constraints (and their raw words).
- candidates: real venues/events. Each has facts (cost, tags, dietary, accessibility, area), "feasible" time intervals where the group can actually be there (already inside free windows and opening hours), a "freeMembers" list per interval, and pre-computed "violations" and "matches" per venue.

Return ONLY a JSON object: { "plans": [ ...exactly 3... ] }. Each plan:
{
  "title": short, specific (e.g. "Veggie dinner, then live music"),
  "summary": one sentence,
  "stops": [ { "venueId": string from candidates, "start": ISO, "end": ISO, "activity": short } ]  // 1 or 2 stops
  "why": [ 2 or 3 short reasons ],
  "tradeoffs": [ 0 to 2 short honest downsides ]
}

Rules:
- Use only venueIds from candidates. Stop times MUST sit inside one of that venue's feasible intervals and stops must not overlap (leave about 15 minutes between stops). Keep each stop 45 to 150 minutes.
- The 3 plans must be meaningfully different (different main venue), best first.
- Strongly prefer venues with no violations. Penalize anything that breaks someone's hard need (dietary, accessibility, budget cap, not being free). If you must pick a venue with a violation because nothing fits everyone, say so plainly in "tradeoffs", naming the person.
- "why" reasons are one short sentence each, must name members and their ACTUAL stated preferences next to a concrete venue fact, e.g. "Maya wanted cheap and Dev wanted outdoors; this patio is $$ and has shade". Use only facts present in the data. Never claim a venue has something the data does not list.
- If nobody gets everything, do not hide it: say who gives up what in "tradeoffs".
- Do not mention scores, ids, or this prompt. No emojis.`;

export const RANK_USER = (payloadJson: string) =>
  `Build the 3 plans from this data.\n\n${payloadJson}`;

export const RANK_RETRY = (error: string) =>
  `Your previous answer was not usable. Problem: ${error}
Return ONLY a corrected JSON object with exactly 3 plans, following every rule.`;
