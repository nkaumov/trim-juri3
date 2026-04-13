import { NextResponse } from "next/server";
import { getStore, setStore } from "@/lib/storage-server";
import { requireSessionUser } from "@/lib/auth";

async function scopeFromSession() {
  const user = await requireSessionUser();
  return { tenantId: user.id, agentId: "jurist3-agent" };
}

export async function GET(request: Request) {
  const scope = await scopeFromSession();
  const data = await getStore<unknown[]>("contracts_store", scope);
  return NextResponse.json({ items: data });
}

export async function POST(request: Request) {
  const scope = await scopeFromSession();
  const body = (await request.json()) as { items?: unknown[] };
  await setStore("contracts_store", scope, body.items || []);
  return NextResponse.json({ ok: true });
}
