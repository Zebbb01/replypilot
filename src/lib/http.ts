import { createHash } from "node:crypto";

export const fail = (status: number, error: string) => Response.json({ error }, { status });

export const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");

// Container Apps puts the caller's address first in X-Forwarded-For. Only a salted
// hash is kept, for the daily demo limit.
export function clientKey(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  return sha256(`${process.env.IP_SALT ?? "replypilot"}:${ip}`).slice(0, 32);
}
