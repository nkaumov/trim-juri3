import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { getStore } from "@/lib/storage-server";
import { getDocument } from "@/lib/documents";
import {
  extractDocxComments,
  extractDocumentText,
  splitTextIntoBlocks,
  type ExtractedDocumentText,
} from "@/lib/document-text";
import { buildCounterpartyWorkInputV1 } from "@/lib/platform/build-input-v1";
import { executeViaPlatformHub } from "@/lib/platform/hub-client";
import { extractJsonFromText } from "@/lib/platform/json";

export const runtime = "nodejs";

type ContractStoreItem = {
  id: string;
  clientId?: string;
  templateDocId?: string;
  templateFileUrl?: string;
  templateName?: string;
  platformStates?: unknown;
  [key: string]: unknown;
};

function isContractStoreItem(value: unknown): value is ContractStoreItem {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { id?: unknown }).id === "string";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

type StoredProtocolRow = { clause?: unknown; clientText?: unknown; ourText?: unknown };

function asStoredProtocolRows(value: unknown): StoredProtocolRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x) => x && typeof x === "object") as StoredProtocolRow[];
}

function makeProtocolTextFromRows(rows: StoredProtocolRow[]): ExtractedDocumentText {
  const chunks: string[] = [];
  for (const row of rows) {
    const clause = asString(row.clause).trim() || "—";
    const clientText = asString(row.clientText).trim();
    const ourText = asString(row.ourText).trim();
    if (!clientText && !ourText) continue;
    chunks.push(`${clause} Контрагент: ${clientText}\nНаша редакция: ${ourText}`.trim());
  }
  const plain = chunks.join("\n\n").trim();
  return { plain, blocks: splitTextIntoBlocks(plain) };
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

function makeTextFromMessage(message: string): ExtractedDocumentText {
  const plain = String(message || "").trim();
  return { plain, blocks: splitTextIntoBlocks(plain) };
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

    const formData = await request.formData();
    const contractId = String(formData.get("contractId") || "").trim();
    const message = String(formData.get("message") || "").trim();
    const file = formData.get("file") as File | null;
    const debug = String(formData.get("debug") || "").trim() === "1";

    if (!contractId) {
      return NextResponse.json({ error: "missing contractId" }, { status: 400 });
    }

    const contracts = await getStore<unknown[]>("contracts_store", scope);
    const list = Array.isArray(contracts) ? contracts.filter(isContractStoreItem) : [];
    const contract = list.find((item) => item.id === contractId);
    if (!contract) {
      return NextResponse.json({ error: "contract not found" }, { status: 404 });
    }

    const knowledge = await getStore<Record<string, unknown>[]>("knowledge_store", scope);
    const knowledgeList = Array.isArray(knowledge) ? knowledge : [];

    const templateDocId =
      extractDocumentId(asString(contract.templateFileUrl)) || asString(contract.templateDocId);

    const templateKnowledgeDoc = knowledgeList.find((item) => {
      if (item?.section !== "templates") return false;
      const sameId = asString(item?.id) && asString(item?.id) === asString(contract.templateDocId);
      const sameFile = extractDocumentId(asString(item?.fileUrl)) === templateDocId;
      const sameName = asString(item?.fileName) && asString(item?.fileName) === asString(contract.templateName);
      return sameId || sameFile || sameName;
    });

    const templateRules = asString(templateKnowledgeDoc?.rules).trim();

    const storedStates = asArray(contract.platformStates)
      .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : null))
      .filter(Boolean) as Record<string, unknown>[];

    const lastState = storedStates.length > 0 ? storedStates[0] : null;
    const lastRows = lastState ? asStoredProtocolRows(lastState["protocolRows"]) : [];
    const hasLastProtocol = lastRows.length > 0;

    let templateText: ExtractedDocumentText | undefined = undefined;
    let templateFileName: string | undefined = undefined;
    let templateMimeType: string | undefined = undefined;
    if (templateDocId) {
      const templateDoc = await getDocument(templateDocId, scope);
      if (templateDoc) {
        templateFileName = templateDoc.fileName;
        templateMimeType = templateDoc.mimeType;
        templateText = await extractDocumentText(templateDoc.buffer, templateDoc.fileName);
      }
    }

    let counterpartyText: ExtractedDocumentText | undefined = undefined;
    let counterpartyMeta: Record<string, unknown> | undefined = undefined;
    let counterpartyFileName: string | undefined = undefined;
    let counterpartyMimeType: string | undefined = undefined;
    let counterpartyFileSize: number | undefined = undefined;

    if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      counterpartyFileName = file.name;
      counterpartyMimeType = file.type || "application/octet-stream";
      counterpartyFileSize = file.size;
      counterpartyMeta = { ...(counterpartyMeta ?? {}), source: "file" };

      const extracted = await extractDocumentText(buffer, file.name);
      counterpartyText = extracted;

      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (ext === "docx") {
        const comments = extractDocxComments(buffer);
        if (comments.length > 0) {
          counterpartyMeta = { ...(counterpartyMeta ?? {}), docxComments: comments };
        }
      }
    } else if (message.trim()) {
      counterpartyText = makeTextFromMessage(message);
      counterpartyMeta = { source: "message" };
    }

    const platformInput = buildCounterpartyWorkInputV1({
      tenantId: scope.tenantId,
      agentId: scope.agentId,
      contractId: contract.id,
      clientId: contract.clientId,
      userMessage: message,
      template: {
        docId: templateDocId || undefined,
        fileName: templateFileName || contract.templateName,
        mimeType: templateMimeType,
        text: templateText,
        meta: {
          templateName: contract.templateName,
        },
        rulesText: templateRules || "",
      },
      counterparty: {
        fileName: counterpartyFileName,
        mimeType: counterpartyMimeType,
        fileSize: counterpartyFileSize,
        text: counterpartyText,
        meta: counterpartyMeta,
      },
      protocol: hasLastProtocol
        ? {
            fileName: "protocol-draft.txt",
            mimeType: "text/plain",
            text: makeProtocolTextFromRows(lastRows),
            meta: {
              stateId: asString(lastState?.["id"]),
              createdAt: asString(lastState?.["createdAt"]),
            },
          }
        : undefined,
      tasks: [{ type: "protocol_draft" }],
    });

    let platformOutput: unknown | null = null;
    let platformError: string | null = null;
    let conversationId: string | null = null;
    let responseTextPreview: string | null = null;

    if (!apiKey) {
      platformError = "PLATFORM_API_KEY is not configured";
    } else {
      try {
        conversationId = `jurist3:contract:${contract.id}`;
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
        const trimmed = String(hubResult.text || "").trim();
        if (debug || !platformOutput) {
          const trimmed = String(hubResult.text || "").trim();
          responseTextPreview = trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}…` : trimmed;
        }
        if (!platformOutput) {
          const preview = responseTextPreview ? ` preview: ${responseTextPreview.slice(0, 240)}` : "";
          platformError = `platform response is not JSON (check agent prompt).${preview}`;
        }
      } catch (error) {
        platformError = error instanceof Error ? error.message : "platform execute failed";
      }
    }

    return NextResponse.json(
      {
        ok: true,
        contractId: contract.id,
        conversationId,
        platformOutput,
        platformError,
        responseTextPreview,
      },
      { status: platformError ? 502 : 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("UNAUTHORIZED")) {
      return NextResponse.json({ ok: false, platformError: "UNAUTHORIZED" }, { status: 401 });
    }
    // surface error in logs for debugging production issues
    console.error("[platform/debug-input] failed:", error);
    return NextResponse.json({ ok: false, platformError: message }, { status: 500 });
  }
}
