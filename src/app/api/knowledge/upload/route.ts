import { NextResponse } from "next/server";
import { saveDocument } from "@/lib/documents";
import { requireSessionUser } from "@/lib/auth";
import { isUnauthorizedError, unauthorizedResponse } from "@/lib/http-errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const user = await requireSessionUser();
    const tenantId = user.id;
    const agentId = "jurist3-agent";
    const docId = await saveDocument({
      tenantId,
      agentId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      buffer,
    });

    return NextResponse.json({
      fileUrl: `/api/knowledge/files/${docId}`,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) return unauthorizedResponse();
    throw error;
  }
}
