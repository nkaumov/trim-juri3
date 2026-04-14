import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { getStore, setStore } from "@/lib/storage-server";
import { saveDocument } from "@/lib/documents";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const scope = { tenantId: user.id, agentId: "jurist3-agent" };
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const contractId = String(formData.get("contractId") || "").trim();

    if (!file || !contractId) {
      return NextResponse.json({ error: "missing file or contractId" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const docId = await saveDocument({
      tenantId: scope.tenantId,
      agentId: scope.agentId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      buffer,
    });

    const fileUrl = `/api/contracts/files/${docId}`;

    const contracts = await getStore<any[]>("contracts_store", scope);
    const next = Array.isArray(contracts)
      ? contracts.map((item) => {
          if (!item || item.id !== contractId) return item;
          return {
            ...item,
            protocolFileUrl: fileUrl,
            protocolFileName: file.name,
            protocolUpdatedAt: new Date().toISOString(),
          };
        })
      : contracts;

    await setStore("contracts_store", scope, next);

    return NextResponse.json({ fileUrl, fileName: file.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("UNAUTHORIZED")) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to upload" }, { status: 500 });
  }
}
