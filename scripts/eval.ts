// Runs the agent on every sample ticket in samples/scenarios.json against a real
// model, grades each draft in code (no model judges another), and writes
// evals/latest.json. With a GitHub token, on GitHub Models' free tier:
//   LLM_API_KEY=$(gh auth token) npm run eval
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { draftReply, memorySteps } from "../src/lib/agent.ts";
import { chat, costUsd, LlmError, type Message, type Tool } from "../src/lib/llm.ts";
import { parsePolicies, searchPolicies } from "../src/lib/policies.ts";
import { llmOptions, sampleOrders, STORE } from "../src/lib/runtime.ts";
import { grade, SCENARIOS } from "../src/lib/scenarios.ts";

const o = llmOptions();
if (!o.key || o.model === "mock") throw new Error("Set LLM_API_KEY (and LLM_MODEL/LLM_ENDPOINT for a model other than GitHub Models' openai/gpt-4.1-mini).");
const policies = parsePolicies(await readFile("policies/store-policies.md", "utf8"));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The free tier allows about 15 requests a minute, so rate limits are waited out.
async function llm(messages: Message[], tools: Tool[]) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await chat(o, messages, tools);
    } catch (e) {
      if (!(e instanceof LlmError) || !e.retryable || attempt === 5) throw e;
      await sleep(e.retryAfterMs ?? 10_000 * attempt);
    }
  }
}

const results = [];
for (const s of SCENARIOS) {
  const steps = memorySteps();
  const started = Date.now();
  let draft = null;
  let error: string | undefined;
  try {
    draft = await draftReply(
      { source: s.source === "shopify" ? "shopify" : "email", customerEmail: s.from.email, customerName: s.from.name, subject: s.subject, body: s.body },
      { step: steps.step, llm, findOrders: sampleOrders, searchPolicies: (q) => searchPolicies(policies, q), store: STORE, today: new Date().toISOString().slice(0, 10) },
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const failures = grade(s, draft, error);
  const tokensIn = steps.usage.reduce((n, u) => n + u.tokensIn, 0);
  const tokensOut = steps.usage.reduce((n, u) => n + u.tokensOut, 0);
  const result = {
    id: s.id,
    title: s.title,
    pass: failures.length === 0,
    failures,
    llmCalls: steps.usage.length,
    tokensIn,
    tokensOut,
    costUsd: costUsd(o.model, { tokensIn, tokensOut }),
    ms: Date.now() - started,
    tools: draft?.tools ?? [],
    blockedBy: draft?.checks.filter((c) => c.status === "fail").map((c) => c.id) ?? [],
    reply: draft?.reply ?? null,
  };
  results.push(result);
  console.log(`${result.pass ? "PASS" : "FAIL"}  ${s.id.padEnd(22)} ${result.llmCalls} calls  $${result.costUsd.toFixed(5)}  ${(result.ms / 1000).toFixed(1)} s${failures.length ? `  ${failures.join("; ")}` : ""}`);
  await sleep(4000);
}

const n = results.length;
const passed = results.filter((r) => r.pass).length;
const median = [...results].map((r) => r.ms).sort((a, b) => a - b)[Math.floor(n / 2)];
const summary = {
  model: o.model,
  ranAt: new Date().toISOString(),
  passed,
  total: n,
  avgCostUsd: results.reduce((x, r) => x + r.costUsd, 0) / n,
  avgLlmCalls: results.reduce((x, r) => x + r.llmCalls, 0) / n,
  avgTokens: results.reduce((x, r) => x + r.tokensIn + r.tokensOut, 0) / n,
  medianMs: median,
};
console.log(
  `\n${passed}/${n} passed on ${o.model}. Per ticket: ${summary.avgLlmCalls.toFixed(1)} model calls, ${Math.round(summary.avgTokens)} tokens, $${summary.avgCostUsd.toFixed(5)} at list price; median ${(median / 1000).toFixed(1)} s.`,
);
await mkdir("evals", { recursive: true });
await writeFile("evals/latest.json", `${JSON.stringify({ ...summary, results }, null, 2)}\n`);
