import { NextResponse } from "next/server";
import { getStore, setStore } from "@/lib/storage-server";
import { requireSessionUser } from "@/lib/auth";

async function scopeFromSession() {
  const user = await requireSessionUser();
  return { tenantId: user.id, agentId: "jurist3-agent" };
}

export async function GET(request: Request) {
  const scope = await scopeFromSession();
  const data = await getStore<Record<string, unknown>>("profile_store", scope);
  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const scope = await scopeFromSession();
  const body = (await request.json()) as { data?: Record<string, unknown> };
  await setStore("profile_store", scope, body.data || {});
  return NextResponse.json({ ok: true });
}
