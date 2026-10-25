// Runs the venue search for the seeded demo group so the SerpApi cache file is filled.
// Needs SERPAPI_KEY. Commit server/cache/serpapi-cache.json afterwards so the demo is offline-safe.
import { aggregate, findOverlaps } from "../availability";
import { config } from "../config";
import { log } from "../log";
import { mockConstraints } from "../mockData";
import { searchVenues } from "../serpapi";

if (!config.serpapiKey) {
  console.error("SERPAPI_KEY is not set (put it in the repo-root .env).");
  process.exit(1);
}

const constraints = mockConstraints();
const { windows } = findOverlaps(constraints);
const venues = await searchVenues(aggregate(constraints, windows));
log.info("warm-cache", `${venues.length} venues; cache file: ${config.serpapiCacheFile}`);
const byKind = (k: string) => venues.filter((v) => v.kind === k).length;
log.info("warm-cache", `${byKind("place")} places, ${byKind("event")} events`);
