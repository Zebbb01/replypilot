// The job worker. In Azure it runs beside the web app in the same Container App,
// so it lives exactly as long as the app is awake and costs nothing extra; with
// --watch it keeps polling, without it drains the queue and exits.
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../lib/db.ts";
import { chat } from "../lib/llm.ts";
import { outbox, smtp } from "../lib/mail.ts";
import { parsePolicies, searchPolicies } from "../lib/policies.ts";
import { llmOptions, ordersFor, STORE } from "../lib/runtime.ts";
import { LIVE, purge, runNextJob, type WorkerDeps } from "../lib/tickets.ts";

const watch = process.argv.includes("--watch");
const env = process.env;
const llm = llmOptions();
if (!llm.key) throw new Error("LLM_API_KEY is not set.");

const policies = parsePolicies(readFileSync(path.join(process.cwd(), "policies", "store-policies.md"), "utf8"));
// Only the live inbox sends real email; demo replies go to the outbox.
const sendLive = env.SMTP_URL ? smtp(env.SMTP_URL, env.SMTP_FROM ?? "") : outbox;

const deps: WorkerDeps = {
  llm: (messages, tools) => chat(llm, messages, tools),
  findOrders: ordersFor,
  searchPolicies: (q) => searchPolicies(policies, q),
  send: (workspace, mail) => (workspace === LIVE ? sendLive(mail) : outbox(mail)),
  store: STORE,
  model: llm.model,
  dailyDraftCap: Number(env.DAILY_DRAFT_CAP ?? 40),
};

const log = (event: string, data: object = {}) => console.log(JSON.stringify({ event, ...data, at: new Date().toISOString() }));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const db = await getDb();
await purge(db);
log("worker.started", { watch, model: llm.model });

let purged = Date.now();
for (;;) {
  const ran = await runNextJob(db, deps).catch((e) => {
    log("worker.error", { error: e instanceof Error ? e.message : String(e) });
    return false;
  });
  if (ran) continue;
  if (!watch) break;
  if (Date.now() - purged > 3600_000) {
    await purge(db).catch(() => {});
    purged = Date.now();
  }
  await sleep(1000);
}

log("worker.done");
process.exit(0);
