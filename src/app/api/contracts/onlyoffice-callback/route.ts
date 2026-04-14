import { NextResponse } from "next/server";
import { updateDocument } from "@/lib/documents";
import { verifyDocumentToken } from "@/lib/doc-sign";

export const runtime = "nodejs";

type CallbackPayload = {
  status?: number;
  url?: string;
};

export async function POST(request: Request) {
  const url = new URL(request.url);
  const docId = url.searchParams.get("docId") || "";
  const token = url.searchParams.get("token") || "";
  const exp = Number(url.searchParams.get("exp") || "0");
  const tenantId = url.searchParams.get("tenantId") || "local-tenant";
  const agentId = url.searchParams.get("agentId") || "jurist3-agent";

  if (!docId || !token || !exp || !verifyDocumentToken(docId, exp, token)) {
    return NextResponse.json({ error: 1, message: "invalid token" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => null)) as CallbackPayload | null;
  const status = payload?.status;
  const fileUrl = payload?.url;

  if (!status) {
    return NextResponse.json({ error: 0 });
  }

  if (status !== 2 && status !== 6) {
    return NextResponse.json({ error: 0 });
  }

  if (!fileUrl) {
    return NextResponse.json({ error: 0 });
  }

  const response = await fetch(fileUrl);
  if (!response.ok) {
    return NextResponse.json({ error: 1, message: "download failed" }, { status: 500 });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await updateDocument({
    id: docId,
    tenantId,
    agentId,
    buffer,
  });

  return NextResponse.json({ error: 0 });
}
