// Who is looking. Each browser gets a private demo workspace through a random ID
// in an HttpOnly cookie. The live inbox needs the operator key, kept as a hash in
// a second cookie.
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { sha256 } from "./http.ts";
import { LIVE } from "./tickets.ts";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const secure = process.env.NODE_ENV === "production";

export async function workspaceId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get("ws")?.value;
  if (existing && ID.test(existing)) return existing;
  const id = crypto.randomUUID();
  jar.set("ws", id, { httpOnly: true, sameSite: "lax", secure, maxAge: 60 * 60 * 24 * 30, path: "/" });
  return id;
}

const operatorToken = () => (process.env.OPERATOR_KEY ? sha256(`operator:${process.env.OPERATOR_KEY}`) : null);
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function isOperator(): Promise<boolean> {
  const expected = operatorToken();
  const given = (await cookies()).get("op")?.value;
  return Boolean(expected && given && same(given, expected));
}

export async function signIn(key: string): Promise<boolean> {
  const expected = operatorToken();
  if (!expected || !same(sha256(`operator:${key}`), expected)) return false;
  (await cookies()).set("op", expected, { httpOnly: true, sameSite: "strict", secure, maxAge: 60 * 60 * 12, path: "/" });
  return true;
}

export async function signOut() {
  (await cookies()).delete("op");
}

// A demo workspace sees its own tickets; the live inbox is for the operator.
export async function viewer() {
  const [ws, operator] = await Promise.all([workspaceId(), isOperator()]);
  return {
    ws,
    operator,
    canSee: (workspace: string) => workspace === ws || (workspace === LIVE && operator),
    actor: (workspace: string) => (workspace === LIVE ? "operator" : "reviewer"),
  };
}
