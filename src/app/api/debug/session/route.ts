import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();
  const c = await cookies();
  const session = c.get("jurist3_session")?.value ?? null;

  return NextResponse.json({
    ok: true,
    host: h.get("host"),
    forwardedProto: h.get("x-forwarded-proto"),
    cfVisitor: h.get("cf-visitor"),
    hasSessionCookie: Boolean(session),
    sessionPreview: session ? `${session.slice(0, 8)}...` : null,
  });
}

