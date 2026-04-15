import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { saveDocument } from "@/lib/documents";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const scope = { tenantId: user.id, agentId: "jurist3-agent" };
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
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

    return NextResponse.json({ docId, fileUrl, fileName: file.name, fileSize: file.size });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("UNAUTHORIZED")) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to upload" }, { status: 500 });
  }
}
