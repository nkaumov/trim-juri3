import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { getStore, setStore } from "@/lib/storage-server";

export const runtime = "nodejs";

type ProtocolColumnTitles = {
  client: string;
  our: string;
  agreed: string;
};

function isTitles(value: unknown): value is ProtocolColumnTitles {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.client === "string" &&
    typeof v.our === "string" &&
    typeof v.agreed === "string"
  );
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const scope = { tenantId: user.id, agentId: "jurist3-agent" };
    const body = (await request.json().catch(() => null)) as
      | { contractId?: string; titles?: unknown }
      | null;

    const contractId = String(body?.contractId || "").trim();
    const titles = body?.titles;
    if (!contractId || !isTitles(titles)) {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }

    const nextTitles: ProtocolColumnTitles = {
      client: String(titles.client || "").trim(),
      our: String(titles.our || "").trim(),
      agreed: String(titles.agreed || "").trim(),
    };

    const contracts = await getStore<any[]>("contracts_store", scope);
    const list = Array.isArray(contracts) ? contracts : [];
    const updated = list.map((item) => {
      if (!item || item.id !== contractId) return item;
      return {
        ...item,
        protocolColumnTitles: nextTitles,
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

