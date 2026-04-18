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

  const port = process.env.PORT || "3000";
  const internalUrl = new URL(`http://127.0.0.1:${port}/api/auth/me`);
  return fetch(internalUrl.toString(), {
    headers: {
      cookie: request.headers.get("cookie") || "",
    },
  })
    .then((res) => {
      if (res.status === 200) {
        return NextResponse.next();
      }
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      return NextResponse.redirect(redirectUrl);
    })
    .catch(() => {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      return NextResponse.redirect(redirectUrl);
    });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
