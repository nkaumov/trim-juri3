import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { getStore, setStore } from "@/lib/storage-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const scope = { tenantId: user.id, agentId: "jurist3-agent" };
    const body = (await request.json()) as { contractId?: string; rows?: unknown[] };
    const contractId = String(body.contractId || "").trim();
    if (!contractId || !Array.isArray(body.rows)) {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }

    const contracts = await getStore<any[]>("contracts_store", scope);
    const list = Array.isArray(contracts) ? contracts : [];
    const updated = list.map((item) => {
      if (!item || item.id !== contractId) return item;
      return {
        ...item,
        protocolRows: body.rows,
        protocolUpdatedAt: new Date().toISOString(),
      };
    });

    await setStore("contracts_store", scope, updated);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("UNAUTHORIZED")) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
