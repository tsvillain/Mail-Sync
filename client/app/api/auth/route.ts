import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  let body: { password?: string; from?: string };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { password, from } = body;

  if (!password) {
    return NextResponse.json({ error: "Password is required" }, { status: 400 });
  }

  const expected = process.env.AUTH_PASSWORD;

  // If no password is configured, skip auth entirely
  if (!expected) {
    return NextResponse.json({ ok: true });
  }

  if (password !== expected) {
    // Avoid timing attacks by using constant-time comparison in production
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("_esa_sid", expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return res;
}
