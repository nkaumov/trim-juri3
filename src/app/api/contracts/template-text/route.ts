import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { getStore } from "@/lib/storage-server";
import { getDocument } from "@/lib/documents";
import { extractDocumentText } from "@/lib/document-text";
import { isUnauthorizedError, unauthorizedResponse } from "@/lib/http-errors";

export const runtime = "nodejs";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractDocumentId(fileUrl: string): string | null {
  if (fileUrl.startsWith("/api/contracts/files/")) {
    return fileUrl.replace("/api/contracts/files/", "");
  }
  if (fileUrl.startsWith("/api/knowledge/files/")) {
    return fileUrl.replace("/api/knowledge/files/", "");
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const scope = { tenantId: user.id, agentId: "jurist3-agent" };
    const { searchParams } = new URL(request.url);
    const contractId = String(searchParams.get("contractId") || "").trim();
    if (!contractId) {
      return NextResponse.json({ error: "missing contractId" }, { status: 400 });
    }

    const contracts = await getStore<Record<string, unknown>[]>("contracts_store", scope);
    const list = Array.isArray(contracts) ? contracts : [];
    const contract = list.find((item) => item && String(item["id"] || "") === contractId) ?? null;
    if (!contract) {
      return NextResponse.json({ error: "contract not found" }, { status: 404 });
    }

    const templateDocId =
      extractDocumentId(asString(contract["templateFileUrl"])) || asString(contract["templateDocId"]);
    if (!templateDocId) {
      return NextResponse.json({ error: "missing template doc id" }, { status: 400 });
    }

    const templateDoc = await getDocument(templateDocId, scope);
    if (!templateDoc) {
      return NextResponse.json({ error: "template document not found" }, { status: 404 });
    }

    const extracted = await extractDocumentText(templateDoc.buffer, templateDoc.fileName);

    const knowledge = await getStore<Record<string, unknown>[]>("knowledge_store", scope);
    const knowledgeList = Array.isArray(knowledge) ? knowledge : [];
    const knowledgeDoc = knowledgeList.find((item) => {
      if (item?.section !== "templates") return false;
      const sameId = asString(item?.id) && asString(item?.id) === asString(contract["templateDocId"]);
      const sameFile = extractDocumentId(asString(item?.fileUrl)) === templateDocId;
      const sameName = asString(item?.fileName) && asString(item?.fileName) === asString(contract["templateName"]);
      return sameId || sameFile || sameName;
    });

    return NextResponse.json({
      ok: true,
      template: {
        docId: templateDocId,
        fileName: templateDoc.fileName,
        mimeType: templateDoc.mimeType,
        rules: asString(knowledgeDoc?.rules),
        text: extracted.plain,
        blocks: extracted.blocks,
      },
    });
  } catch (error) {
    if (isUnauthorizedError(error)) return unauthorizedResponse();
    throw error;
  }
}

