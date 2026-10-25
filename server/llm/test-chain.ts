// npm run llm:test (from server/llm): extract each mock member's note, then rank plans on mock venues.
// Uses real providers when keys are in .env; otherwise says so and falls back to the mock constraints.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Constraints, Venue } from "../../shared/types";
import { extractConstraints, rankPlans } from "./index";
import { isConfigured } from "./env";

const mock = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../mock");
const read = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(mock, f), "utf8")) as T;

const sampleConstraints = read<Constraints[]>("constraints.sample.json");
const venues = read<Venue[]>("venues.sample.json");

const live = isConfigured("muse") || isConfigured("gemini");
console.log(
  live
    ? `Providers: muse=${isConfigured("muse")} gemini=${isConfigured("gemini")}`
    : "No provider keys in .env: skipping live extraction, ranking with deterministic plans only.",
);

const constraints: Constraints[] = [];
for (const s of sampleConstraints) {
  if (!live) {
    constraints.push(s);
    continue;
  }
  const c = await extractConstraints({ memberName: s.memberName, text: s.rawTranscript });
  console.log(`\n== ${c.memberName} ==\n${JSON.stringify({ ...c, rawTranscript: undefined }, null, 2)}`);
  constraints.push(c);
}

const plans = await rankPlans(constraints, venues);
console.log("\n=========== 3 PLANS ===========");
for (const p of plans) {
  console.log(`\n#${p.rank} ${p.title}  (score ${p.score}, $${p.estimatedCostPerPerson.min}-${p.estimatedCostPerPerson.max}/person)`);
  console.log(`   ${p.summary}`);
  for (const s of p.stops) console.log(`   - ${s.start.slice(5, 16)} to ${s.end.slice(11, 16)}  ${s.activity}: ${s.venue.name}`);
  for (const w of p.why) console.log(`   + ${w}`);
  for (const t of p.tradeoffs) console.log(`   ! ${t}`);
}
if (plans.length !== 3) {
  console.error(`FAIL: expected 3 plans, got ${plans.length}`);
  process.exit(1);
}
