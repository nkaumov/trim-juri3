import { NextResponse } from "next/server";
import { clearSessionCookie, getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    await clearSessionCookie();
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user });
}
