import { NextResponse, type NextRequest } from "next/server";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Gives a first-time visitor their demo workspace with the page itself, so the
// page's first API calls all carry the same cookie instead of racing to set one.
export function proxy(req: NextRequest) {
  const res = NextResponse.next();
  if (!ID.test(req.cookies.get("ws")?.value ?? "")) {
    res.cookies.set("ws", crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
  }
  return res;
}

export const config = { matcher: "/((?!api/|_next/|icon.svg).*)" };
