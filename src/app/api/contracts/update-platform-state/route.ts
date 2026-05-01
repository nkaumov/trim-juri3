import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { getStore, setStore } from "@/lib/storage-server";
import { isUnauthorizedError, unauthorizedResponse } from "@/lib/http-errors";
import type { ContractPlatformState, ProtocolComment, ProtocolRow } from "@/lib/contracts/types";

export const runtime = "nodejs";

type Payload = {
  contractId?: string;
  stateId?: string;
  patch?: {
    protocolRows?: ProtocolRow[];
    protocolComments?: ProtocolComment[];
    summary?: string;
    recommendation?: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const scope = { tenantId: user.id, agentId: "jurist3-agent" };
    const body = (await request.json().catch(() => null)) as Payload | null;
    const contractId = String(body?.contractId || "").trim();
    const stateId = String(body?.stateId || "").trim();
    const patch = body?.patch;
    if (!contractId || !stateId || !isRecord(patch)) {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }

    const contracts = await getStore<Record<string, unknown>[]>("contracts_store", scope);
    const list = Array.isArray(contracts) ? contracts : [];

    let found = false;
    const updated = list.map((item) => {
      if (!item || String(item["id"] || "") !== contractId) return item;
      found = true;
      const states = Array.isArray(item["platformStates"])
        ? (item["platformStates"] as ContractPlatformState[])
        : [];
      const nextStates = states.map((state) => {
        if (!state || state.id !== stateId) return state;
        return {
          ...state,
          protocolRows: Array.isArray(patch.protocolRows) ? patch.protocolRows : state.protocolRows,
          protocolComments: Array.isArray(patch.protocolComments)
            ? patch.protocolComments
            : state.protocolComments,
          summary: typeof patch.summary === "string" ? patch.summary : state.summary,
          recommendation:
            typeof patch.recommendation === "string" ? patch.recommendation : state.recommendation,
        };
      });

      return {
        ...item,
        platformStates: nextStates,
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

