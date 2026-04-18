import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/health",
  "/api/public-config",
  "/api/debug/session",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/api/knowledge/files/") ||
    pathname.startsWith("/api/contracts/files/") ||
    pathname.startsWith("/api/files/sign") ||
    pathname.startsWith("/api/contracts/onlyoffice-callback")
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  const session = request.cookies.get("jurist3_session")?.value;
  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Middleware runs in the Edge runtime where setting a Cookie header on a subrequest
  // can be restricted. For this app, existence of the session cookie is enough here;
  // API routes still validate sessions server-side.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
