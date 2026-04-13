import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { signDocumentId } from "@/lib/doc-sign";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const docId = url.searchParams.get("docId") || "";
  const kind = url.searchParams.get("kind") || "contracts";

  await requireSessionUser();

  if (!docId) {
    return NextResponse.json({ error: "docId required" }, { status: 400 });
  }

  const expiresAt = Date.now() + 1000 * 60 * 10;
  const token = signDocumentId(docId, expiresAt);

  const path = kind === "knowledge" ? "/api/knowledge/files/" : "/api/contracts/files/";
  return NextResponse.json({
    url: `${path}${docId}?token=${token}&exp=${expiresAt}`,
  });
}
