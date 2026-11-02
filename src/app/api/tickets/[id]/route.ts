import { dayKey, getDb, take } from "@/lib/db.ts";
import { clientKey, fail } from "@/lib/http.ts";
import { viewer } from "@/lib/session.ts";
import { approve, LIVE, regenerate, reject, retry, ReviewError, ticketView } from "@/lib/tickets.ts";

type Ctx = RouteContext<"/api/tickets/[id]">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function load(ctx: Ctx) {
  const { id } = await ctx.params;
  const [v, db] = await Promise.all([viewer(), getDb()]);
  const view = UUID.test(id) ? await ticketView(db, id) : null;
  return { v, db, view: view && v.canSee(view.ticket.workspace) ? view : null };
}

export async function GET(_req: Request, ctx: Ctx) {
  const { view } = await load(ctx);
  if (!view) return fail(404, "Ticket not found.");
  const { workspace, ...ticket } = view.ticket;
  return Response.json({ ...view, ticket: { ...ticket, live: workspace === LIVE } });
}

// The person's review: approve (with the edited reply), reject, draft again, or retry.
export async function POST(req: Request, ctx: Ctx) {
  const { v, db, view } = await load(ctx);
  if (!view) return fail(404, "Ticket not found.");
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const { id, workspace } = view.ticket;
  const actor = v.actor(workspace);
  const str = (k: string) => (typeof body?.[k] === "string" ? (body[k] as string) : "");

  try {
    switch (body?.action) {
      case "approve":
        await approve(db, id, str("reply").slice(0, 4000), actor);
        break;
      case "reject":
        await reject(db, id, str("reason"), actor);
        break;
      case "regenerate":
        if (workspace !== LIVE && !(await take(db, dayKey("demo-ip", clientKey(req)), Number(process.env.DAILY_DEMO_PER_ADDRESS ?? 30)))) {
          return fail(429, "Today's limit for this free demo is reached. Come back tomorrow.");
        }
        await regenerate(db, id, str("note"), actor);
        break;
      case "retry":
        await retry(db, id, actor);
        break;
      default:
        return fail(400, "Unknown action.");
    }
  } catch (e) {
    if (e instanceof ReviewError) return fail(409, e.message);
    throw e;
  }
  return Response.json({ ok: true });
}
