import { NextResponse } from "next/server";
import { signDocumentId } from "@/lib/doc-sign";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const docId = url.searchParams.get("docId") || "";
  const kind = (url.searchParams.get("kind") || "contracts") as "contracts" | "knowledge";
  if (!docId) {
    return NextResponse.json({ error: "docId required" }, { status: 400 });
  }
  const exp = Date.now() + 1000 * 60 * 10;
  const token = signDocumentId(docId, exp);
  const urlPath = kind === "knowledge" ? `/api/knowledge/files/${docId}` : `/api/contracts/files/${docId}`;
  const signedUrl = `${urlPath}?token=${encodeURIComponent(token)}&exp=${exp}`;
  return NextResponse.json({ url: signedUrl, docId, exp, token, kind });
}
