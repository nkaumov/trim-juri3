import { NextResponse } from "next/server";
import { getStore, setStore } from "@/lib/storage-server";
import { requireSessionUser } from "@/lib/auth";
import { isUnauthorizedError, unauthorizedResponse } from "@/lib/http-errors";

async function scopeFromSession() {
  const user = await requireSessionUser();
  return { tenantId: user.id, agentId: "jurist3-agent" };
}

export async function GET(request: Request) {
  try {
    const scope = await scopeFromSession();
    const data = await getStore<unknown[]>("clients_store", scope);
    return NextResponse.json({ items: data });
  } catch (error) {
    if (isUnauthorizedError(error)) return unauthorizedResponse();
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const scope = await scopeFromSession();
    const body = (await request.json()) as { items?: unknown[] };
    await setStore("clients_store", scope, body.items || []);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isUnauthorizedError(error)) return unauthorizedResponse();
    throw error;
  }
}
