import { NextResponse } from "next/server";
import { bootstrapAdmin, createSession, loginWithPassword, setSessionCookie } from "@/lib/auth";

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
  await setSessionCookie(sessionId);
  return NextResponse.json({ ok: true, user });
}
