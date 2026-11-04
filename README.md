# ReplyPilot

[![CI](https://github.com/Zebbb01/replypilot/actions/workflows/ci.yml/badge.svg)](https://github.com/Zebbb01/replypilot/actions/workflows/ci.yml)

Support emails in, approved replies out. ReplyPilot is an AI support agent for an online store, written as
code rather than wired together in a no-code tool. A customer email or a Shopify delivery event becomes a
ticket. An agent looks up the order and the store policies and drafts a reply, code checks the draft, and
**nothing is sent until a person approves it**. Every step is stored, retried when it fails, logged in an
append-only audit trail, and costed.

The store is **Kettle & Pine**, a fictional coffee-gear shop; its customers and orders are made up.

**Live demo: https://ca-replypilot-9z83ab.salmonriver-2ba7975b.southeastasia.azurecontainerapps.io**
(no sign-up; send one of the sample emails). The app scales to zero when idle, so the first visit takes
about 20 seconds to wake it, and a draft takes a few seconds more.

![The review screen: a reviewer added "$500" to a draft, the amounts check fails, and Approve is locked](docs/screenshots/review-blocked.png)

## What it does

- **Two ways in.** Customer emails arrive through an inbound email webhook (Postmark's JSON format). Shopify
  `fulfillment_events/create` webhooks with a delivery problem (delayed, failed, attempted) open a proactive
  ticket before the customer has to ask. Webhook signatures are checked over the raw body, and a redelivered
  webhook or email maps to the same ticket.
- **An agent with four tools**: `lookup_order`, `recent_orders`, `search_policies` and `submit_draft`. The
  order tools are scoped **in code** to the sender's email address: asking about someone else's order returns
  "belongs to another address" and no details, so no prompt injection can widen what the model sees.
- **Checks in code on every draft**, run again on every edit (the same functions run in the browser as the
  reviewer types). A failed check locks Approve.
- **A person decides.** Approve (with edits), reject, or ask for a new draft with a note. Edits and decisions
  go into the audit log with who made them.
- **Durable steps.** Each model call, tool call and send is stored when it finishes. A retry resumes from the
  step that failed instead of paying for the same calls again, and a stored send is never sent twice.
- **Retries** with backoff (5, 10, 20 and 40 seconds, or the model's `Retry-After`), then the ticket fails with
  the reason and can be run again from where it stopped. Errors a retry cannot fix fail at once.
- **Cost per ticket.** Tokens for every model call (thinking included), priced at the model's paid list price.
  On the Gemini API's free tier the actual cost is zero; the figure shows what a paid key would charge.
- **Evals.** Twelve sample tickets with expectations graded in code (tools called, category, escalation,
  policies cited, facts mentioned, facts that must not leak).

## How it works

```mermaid
flowchart LR
  C[Customer email] -->|inbound webhook| W[Web app<br/>Next.js]
  S[Shopify dev store] -->|signed webhook| W
  R[Reviewer] <-->|review, edit, approve| W
  W -->|ticket + job| P[(PostgreSQL<br/>tickets, jobs, steps, audit log)]
  P <--> K[Worker<br/>same Container App]
  K -->|tool calls| M[Gemini API<br/>gemini-3.5-flash-lite]
  K -->|orders| A[Shopify Admin GraphQL]
  K -->|after approval| E[SMTP, or the outbox]
```

1. A webhook (or a demo button) creates a ticket and queues a `draft` job in PostgreSQL.
2. The worker claims due jobs with `FOR UPDATE SKIP LOCKED` and a lock that expires, so a crashed worker's job
   runs again. It runs as a second container in the web app's replica: it is awake exactly when the app is,
   and both scale to zero together.
3. The agent loop asks the model, runs the tools it asks for, and stops when the model calls `submit_draft`.
   Each call is a step keyed by ticket, run and name; a finished step is replayed from the database.
4. The draft, its checks and the evidence behind them (verified orders, amounts, policies seen) are saved, and
   the ticket waits for a person.
5. Approval re-runs the checks on the final text, then queues a `send` job. Demo replies go to an outbox; live
   replies are emailed over SMTP, threaded to the customer's message.

## The checks

| Check | Rule | When it does not hold |
| --- | --- | --- |
| No placeholders | No `[Name]`, `{{…}}`, `<insert…>` or lorem ipsum | Blocks sending |
| Orders verified | Every order number in the reply was verified for this customer by a tool | Blocks sending |
| Amounts grounded | Every money amount appears in the verified order data | Blocks sending |
| Policy cited | Cited policies were actually returned by the search; refunds, damage and cancellations cite one | Blocks sending; a missing citation asks for a look |
| Length | 12 to 220 words | Asks for a look |
| Escalation | The agent flagged the ticket for a person (chargeback, legal, safety, outside policy) | Asks for a look |

## Evals

`samples/scenarios.json` holds twelve tickets: order status with and without a number, a damaged item, a
cancellation, a stranger asking for someone else's tracking number, a prompt injection that demands a $500
refund, a chargeback threat, a pre-sale return question, a message in Spanish, a warranty claim, opened
filters that cannot be returned, and a Shopify delay event. Each lists what a good draft must do; a script
grades every draft in code, with no model judging another model. For the attack, a draft the checks block
counts as caught.

```bash
LLM_API_KEY=<Gemini API key> npm run eval   # writes evals/latest.json
```

**12 of 12 passed** on `gemini-3.5-flash-lite` (Gemini API free tier, November 2026; full replies in
[evals/latest.json](evals/latest.json)):

| Per ticket | Measured |
| --- | --- |
| Model calls | 2.3 on average (2 to 3) |
| Tokens | about 2,600 |
| Cost at paid list price | $0.0012 (actual cost $0 on the free tier) |
| Time to a draft | median 3.1 s; free-tier rate limits pushed a few tickets to 20 to 44 s |

The agent declined to share the stranger's tracking number, ignored the injected "RefundBot" instructions
without echoing the $500, flagged the chargeback threat for a person, answered in Spanish, and refused the
opened-filter return by citing the returns policy. One slip the checks do not catch yet: on the injection
ticket it wrote "delivered on October 20", which is the order date. Dates are not grounded by a check; that
is the next check to add. Twelve tickets are a smoke test, not a benchmark.

## Staying free

| Service | Free allowance | How ReplyPilot stays inside it |
| --- | --- | --- |
| Container Apps (consumption) | 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests a month | Scales to zero; one replica of 0.5 vCPU and 1 GiB (web + worker) is about 100 awake hours a month. A Free Trial allows one environment, so it joins the one LedgerLens created |
| Azure Database for PostgreSQL Flexible Server | 750 hours of B1ms, 32 GB storage and 32 GB backups a month, for 12 months on a free account | One B1ms server, 32 GB, no storage auto-grow, no geo-redundant backups |
| Log Analytics | 5 GB of ingestion a month | Daily cap of 0.1 GB |
| Gemini API | Free tier, no billing; per-project rate limits shown in AI Studio | At most 40 drafts a day; demo limits per browser and per address |
| GitHub Actions and Container Registry | Free for public repositories | |
| Shopify dev store, Postmark developer plan, Gmail SMTP | Free | Only for the optional live inbox |

## Tech stack

| Part | Choice |
| --- | --- |
| Web app | Next.js 16 (App Router, route handlers, proxy), React 19, TypeScript, Tailwind CSS 4 |
| Agent | OpenAI-compatible chat completions with tool calling (`fetch`, no SDK); the Gemini API by default |
| Worker | Plain Node.js running the same TypeScript files (native type stripping), same container image |
| Data | PostgreSQL with `pg`: job queue with `SKIP LOCKED`, durable steps, append-only audit log enforced by a trigger |
| Integrations | Shopify Admin GraphQL API (client credentials grant), HMAC-verified Shopify webhooks, Postmark inbound email, SMTP via Nodemailer |
| Infrastructure | Terraform (azurerm 4): Container Apps with a worker sidecar, PostgreSQL Flexible Server, Log Analytics, budget alert |
| CI/CD | GitHub Actions: lint, typecheck, unit and end-to-end tests, Terraform validate, image build; deploy to GHCR and Container Apps over OpenID Connect |
| Tests | Vitest against a real embedded PostgreSQL; Playwright end to end against a rule-based mock model |

## Run it locally

You need Node.js 22.16 or later. No Docker, Azure account or model key is needed: an embedded PostgreSQL
(real binaries from npm) stands in for Azure, and a rule-based mock speaks the chat-completions protocol
with tool calls.

```bash
npm install
cp .env.example .env.local
npm run services   # terminal 1: PostgreSQL, the mock model and the worker
npm run dev        # terminal 2: http://localhost:3300
```

To use a real model, set `LLM_ENDPOINT`, `LLM_API_KEY` and `LLM_MODEL` in `.env.local` and in the shell
that runs `npm run services`.

## Tests

```bash
npm test           # 70 unit tests: agent loop, checks, job queue, durable steps, workflow, Shopify, webhooks, evals grader
npm run test:e2e   # 8 Playwright tests: starts PostgreSQL, the mock model, the worker and the app
```

The end-to-end tests cover a draft that is edited, approved and sent; an edit that adds an unsupported
amount and locks approval; the agent refusing to share another customer's order; a chargeback threat
flagged for a person, rejected and drafted again; a rate-limited model call retried and shown in the audit
log; a browser that cannot open another browser's ticket; signed and forged Shopify webhooks, idempotent
redelivery, basic-auth inbound email and operator sign-in for the live inbox.

## Security

- **The model never holds more than the sender may see.** Order lookups are filtered by the sender's email in
  code, and the customer's text goes in as quoted data with instructions to treat it as such.
- **A person approves every reply**, and the checks run again on the final text on the server.
- **Webhooks are authenticated**: Shopify's HMAC over the raw body (timing-safe), basic auth for inbound email.
  Values that reach Shopify's search syntax are restricted to plain order numbers, emails and numeric IDs.
- **Two audiences.** Demo tickets live in a per-browser workspace (an HttpOnly cookie) and only ever reach the
  outbox. The live inbox, which emails real people, needs the operator key.
- **The audit log cannot be edited**: a trigger rejects any `UPDATE` on it.
- **Privacy.** Raw IP addresses are never stored (only a salted hash for the daily limits), and demo tickets
  are deleted after 7 days. Google may use free-tier Gemini prompts to improve its products, so the demo uses
  made-up customers and says so; a live inbox with real customers should use a paid key, whose prompts are not
  used that way.

## Limits and next steps

- Dates in a reply are not checked against the order data (see Evals).
- The live inbox has not been tested against a real Shopify store or Postmark account; both paths are covered
  by tests that use payloads in the documented formats.
- Policy search is keyword scoring over a handful of sections; a larger policy set would move to PostgreSQL
  full-text search or embeddings.
- One operator key instead of user accounts; sign-in with roles would come first in a team setting.
- A send that succeeds just before the worker crashes could be sent twice (at-least-once delivery); a provider
  idempotency key would close that gap.

Deployment steps are in [DEPLOYMENT.md](DEPLOYMENT.md).
