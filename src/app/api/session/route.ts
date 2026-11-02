import { dayKey, getDb, take } from "@/lib/db.ts";
import { clientKey, fail } from "@/lib/http.ts";
import { signIn, signOut } from "@/lib/session.ts";

export async function POST(req: Request) {
  const { key } = ((await req.json().catch(() => null)) ?? {}) as { key?: unknown };
  if (!(await take(await getDb(), dayKey("signin-ip", clientKey(req)), 20))) return fail(429, "Too many attempts today.");
  if (typeof key !== "string" || !(await signIn(key))) return fail(401, "That key is not right.");
  return new Response(null, { status: 204 });
}

export async function DELETE() {
  await signOut();
  return new Response(null, { status: 204 });
}
