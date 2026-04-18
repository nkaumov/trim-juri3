import { NextResponse } from "next/server";
import { bootstrapAdmin, createSession, loginWithPassword, setSessionCookie } from "@/lib/auth";

function isHttpsRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto && forwardedProto.toLowerCase().includes("https")) {
    return true;
  }
  const cfVisitor = request.headers.get("cf-visitor");
  if (cfVisitor) {
    try {
      const parsed = JSON.parse(cfVisitor) as { scheme?: string };
      if (parsed?.scheme === "https") return true;
    } catch {
      // ignore
    }
  }
  return false;
}

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase() || "";
  const password = body.password || "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  let user = await loginWithPassword(email, password);
  if (!user) {
    const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (adminEmail && adminPassword && adminEmail === email && adminPassword === password) {
      user = await bootstrapAdmin(email, password);
    } else {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
  }

  const sessionId = await createSession(user.id);
  await setSessionCookie(sessionId, { secure: isHttpsRequest(request) });
  return NextResponse.json({ ok: true, user });
}
