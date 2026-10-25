import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { config } from "./config";
import { getLlm } from "./llmClient";
import { log } from "./log";
import { searchVenues } from "./serpapi";
import { DEMO_GROUP_ID, Store } from "./store";

const store = new Store();
store.seedDemo();

const llm = await getLlm();
const app = createApp({ store, llm, searchVenues });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  log.info("server", `listening on http://localhost:${info.port}`);
  log.info("server", `demo group: GET /api/groups/${DEMO_GROUP_ID}`);
  log.info(
    "server",
    config.serpapiKey
      ? "SERPAPI_KEY set: cache first, live calls on a miss"
      : "SERPAPI_KEY not set: cached responses only, mock venues on a miss",
  );
  log.info("server", `MUSE_MODEL=${process.env.MUSE_MODEL || "(unset)"}`);
});
