import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth", "/api/server"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Pass through public paths (login page, auth API, server proxy)
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get("_esa_sid")?.value;
  const expected = process.env.AUTH_PASSWORD;

  // If no password is configured, skip auth entirely
  if (!expected) return NextResponse.next();

  if (token !== expected) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?from=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
