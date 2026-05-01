import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { getStore, setStore } from "@/lib/storage-server";
import { isUnauthorizedError, unauthorizedResponse } from "@/lib/http-errors";
import type { ContractPlatformState } from "@/lib/contracts/types";

export const runtime = "nodejs";

type Payload = {
  contractId?: string;
  state?: ContractPlatformState;
};

function isState(value: unknown): value is ContractPlatformState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.createdAt === "string" && typeof v.task === "string";
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const scope = { tenantId: user.id, agentId: "jurist3-agent" };
    const body = (await request.json().catch(() => null)) as Payload | null;
    const contractId = String(body?.contractId || "").trim();
    if (!contractId || !isState(body?.state)) {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }

    const contracts = await getStore<Record<string, unknown>[]>("contracts_store", scope);
    const list = Array.isArray(contracts) ? contracts : [];

    let found = false;
    const updated = list.map((item) => {
      if (!item || String(item["id"] || "") !== contractId) return item;
      found = true;
      const states = Array.isArray(item["platformStates"]) ? (item["platformStates"] as unknown[]) : [];
      return {
        ...item,
        platformStates: [body!.state!, ...states],
      };
    });

    if (!found) {
      return NextResponse.json({ error: "contract not found" }, { status: 404 });
    }

    await setStore("contracts_store", scope, updated);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isUnauthorizedError(error)) return unauthorizedResponse();
    throw error;
  }
}

