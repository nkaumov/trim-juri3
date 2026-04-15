import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createIntegrationSessionCookieValue } from "@/lib/auth";

export const runtime = "nodejs";

const TOKEN_PARAM = "juri_api_token";
const ORIGIN_PARAM = "origin";
const NEXT_PARAM = "next";
const SESSION_COOKIE = "jurist3_session";
const EXTERNAL_PRODUCT_INTROSPECT_PATH = "/api/v1/external/product-keys/introspect";

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  return raw;
}

function integrationUserFromToken(token: string): { id: string; email: string } {
  const hash = crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
  return {
    id: `integration-${hash}`,
    email: process.env.JURI3_INTEGRATION_USER_EMAIL || "integration@jurist3.local",
  };
}

function getPlatformApiBaseUrl(): string {
  return (
    process.env.JURI3_PLATFORM_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://localhost:8000"
  );
}

async function verifyPlatformProductKeyInRoute(apiKey: string, origin: string): Promise<boolean> {
  if (!apiKey.startsWith("pk_")) return false;

  const baseUrl = getPlatformApiBaseUrl().replace(/\/$/, "");
  const target = `${baseUrl}${EXTERNAL_PRODUCT_INTROSPECT_PATH}`;
  try {
    const response = await fetch(target, {
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

export async function GET(request: NextRequest) {
  const token = (request.nextUrl.searchParams.get(TOKEN_PARAM) || "").trim();
  const origin = (request.nextUrl.searchParams.get(ORIGIN_PARAM) || "").trim();
  const nextPath = safeNextPath(request.nextUrl.searchParams.get(NEXT_PARAM));

  if (!token || !origin) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const expectedToken = process.env.JURI3_INTEGRATION_API_TOKEN || "";
  const isStaticToken = !!expectedToken && token === expectedToken;
  const isPlatformToken = token.startsWith("pk_")
    ? await verifyPlatformProductKeyInRoute(token, origin)
    : false;

  if (!isStaticToken && !isPlatformToken) {
    return NextResponse.json(
      {
        error: "invalid_integration_token",
        token_present: !!token,
        origin_present: !!origin,
        is_static_token: isStaticToken,
        is_platform_token: isPlatformToken,
        token_preview: token.slice(0, 24),
        origin,
        platform_base_url: getPlatformApiBaseUrl(),
      },
      { status: 401 },
    );
  }

  const integrationUser = integrationUserFromToken(token);
  const sessionValue = createIntegrationSessionCookieValue(
    integrationUser.id,
    integrationUser.email,
    origin,
  );
  const response = NextResponse.redirect(new URL(nextPath, request.url));
  response.cookies.set(SESSION_COOKIE, sessionValue, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return response;
}
