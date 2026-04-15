import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/auth/integration/exchange",
];
const SESSION_COOKIE = "jurist3_session";
const INTEGRATION_TOKEN_QUERY_PARAM = "juri_api_token";
const INTEGRATION_ORIGIN_QUERY_PARAM = "origin";
const EXTERNAL_PRODUCT_INTROSPECT_PATH = "/api/v1/external/product-keys/introspect";

function getPlatformApiBaseUrl(): string {
  return (
    process.env.JURI3_PLATFORM_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://localhost:8000"
  );
}

async function verifyPlatformProductKey(apiKey: string, origin: string): Promise<boolean> {
  if (!apiKey.startsWith("pk_")) return false;
  const baseUrl = getPlatformApiBaseUrl().replace(/\/$/, "");
  try {
    const response = await fetch(`${baseUrl}${EXTERNAL_PRODUCT_INTROSPECT_PATH}`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product_code: "juri3",
        origin,
      }),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function getValidIntegrationToken(
  request: NextRequest,
): Promise<{ token: string; origin: string } | null> {
  const queryToken = request.nextUrl.searchParams.get(INTEGRATION_TOKEN_QUERY_PARAM);
  const headerToken = request.headers.get("x-juri-api-token");
  const token = queryToken || headerToken;
  if (!token) {
    return null;
  }

  const originFromQuery = request.nextUrl.searchParams.get(INTEGRATION_ORIGIN_QUERY_PARAM);
  const originFromHeader = request.headers.get("x-juri-origin");
  const origin = originFromQuery || originFromHeader;
  if (!origin) {
    return null;
  }

  const expectedToken = process.env.JURI3_INTEGRATION_API_TOKEN || "";
  if (expectedToken && token === expectedToken) {
    return { token, origin };
  }

  if (token.startsWith("pk_")) {
    return { token, origin };
  }

  return (await verifyPlatformProductKey(token, origin)) ? { token, origin } : null;
}

export async function middleware(request: NextRequest) {
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

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
    const integrationData = await getValidIntegrationToken(request);
    if (integrationData) {
      const exchangeUrl = request.nextUrl.clone();
      exchangeUrl.pathname = "/api/auth/integration/exchange";
      exchangeUrl.search = "";
      exchangeUrl.searchParams.set(INTEGRATION_TOKEN_QUERY_PARAM, integrationData.token);
      exchangeUrl.searchParams.set(INTEGRATION_ORIGIN_QUERY_PARAM, integrationData.origin);
      const nextPath = request.nextUrl.pathname + request.nextUrl.search;
      exchangeUrl.searchParams.set("next", nextPath);
      return NextResponse.redirect(exchangeUrl);
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const url = request.nextUrl.clone();
  url.pathname = "/api/auth/me";
  return fetch(url.toString(), {
    headers: {
      cookie: request.headers.get("cookie") || "",
    },
  }).then((res) => {
    if (res.status === 200) {
      return NextResponse.next();
    }
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
