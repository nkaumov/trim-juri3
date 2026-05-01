import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { getStore } from "@/lib/storage-server";
import { getDocument } from "@/lib/documents";
import { extractDocumentText } from "@/lib/document-text";
import { buildRiskAnalysisInputV1 } from "@/lib/platform/build-input-v1";
import { executeViaPlatformHub } from "@/lib/platform/hub-client";
import { extractJsonFromText } from "@/lib/platform/json";

export const runtime = "nodejs";

type AnalysisStoreItem = {
  id: string;
  sourceFileUrl?: string;
  sourceFileName?: string;
  sourceFileSize?: number;
  sourceMimeType?: string;
  [key: string]: unknown;
};

function isAnalysisStoreItem(value: unknown): value is AnalysisStoreItem {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { id?: unknown }).id === "string";
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

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const scope = { tenantId: user.id, agentId: "jurist3-agent" };

    const hubUrl = String(process.env.PLATFORM_HUB_URL || "wss://hub.platform.foxyway.chat/ws").trim();
    const apiKey = String(process.env.PLATFORM_API_KEY || "").trim();
    const origin = String(process.env.PLATFORM_ORIGIN || "").trim() || undefined;
    const timeoutMsRaw = Number(process.env.PLATFORM_TIMEOUT_MS || "");
    const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 180_000;

    const body = (await request.json().catch(() => null)) as
      | { analysisCaseId?: string; userMessage?: string }
      | null;

    const analysisCaseId = String(body?.analysisCaseId || "").trim();
    if (!analysisCaseId) {
      return NextResponse.json({ error: "missing analysisCaseId" }, { status: 400 });
    }

    const items = await getStore<unknown[]>("analysis_store", scope);
    const list = Array.isArray(items) ? items.filter(isAnalysisStoreItem) : [];
    const item = list.find((x) => x.id === analysisCaseId);
    if (!item) {
      return NextResponse.json({ error: "analysis case not found" }, { status: 404 });
    }

    const fileUrl = asString(item.sourceFileUrl);
    const docId = extractDocumentId(fileUrl);
    if (!docId) {
      return NextResponse.json({ error: "missing docId" }, { status: 400 });
    }

    const doc = await getDocument(docId, scope);
    if (!doc) {
      return NextResponse.json({ error: "document not found" }, { status: 404 });
    }

    const extracted = await extractDocumentText(doc.buffer, doc.fileName);

    const platformInput = buildRiskAnalysisInputV1({
      tenantId: scope.tenantId,
      agentId: scope.agentId,
      analysisCaseId,
      userMessage: String(body?.userMessage || ""),
      document: {
        docId,
        fileName: item.sourceFileName ? String(item.sourceFileName) : doc.fileName,
        mimeType: item.sourceMimeType ? String(item.sourceMimeType) : doc.mimeType,
        fileSize: asNumber(item.sourceFileSize),
        text: extracted,
        meta: {
          sourceFileUrl: fileUrl,
        },
      },
      tasks: [{ type: "risk_review" }],
    });

    let platformOutput: unknown | null = null;
    let platformError: string | null = null;
    let conversationId: string | null = null;

    if (!apiKey) {
      platformError = "PLATFORM_API_KEY is not configured";
    } else {
      try {
        conversationId = `jurist3:risk:${analysisCaseId}`;
        const inputString = JSON.stringify(platformInput);
        const hubResult = await executeViaPlatformHub({
          hubUrl,
          apiKey,
          origin,
          userId: scope.tenantId,
          conversationId,
          text: inputString,
          metadata: { platformInput },
          timeoutMs,
        });
        const extracted = extractJsonFromText(hubResult.text);
        platformOutput = extracted.json;
        if (!platformOutput) {
          const trimmed = String(hubResult.text || "").trim();
          const preview = trimmed ? ` preview: ${trimmed.slice(0, 240)}` : "";
          platformError = `platform response is not JSON (check agent prompt).${preview}`;
        }
      } catch (error) {
        platformError = error instanceof Error ? error.message : "platform execute failed";
      }
    }

    return NextResponse.json(
      { ok: true, analysisCaseId, conversationId, platformOutput, platformError },
      { status: platformError ? 502 : 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("UNAUTHORIZED")) {
      return NextResponse.json({ ok: false, platformError: "UNAUTHORIZED" }, { status: 401 });
    }
    console.error("[platform/debug-risk-input] failed:", error);
    return NextResponse.json({ ok: false, platformError: message }, { status: 500 });
  }
}
