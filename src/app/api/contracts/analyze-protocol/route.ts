import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import { requireSessionUser } from "@/lib/auth";
import { getStore, setStore } from "@/lib/storage-server";
import { getDocument } from "@/lib/documents";
import type {
  ProtocolComment,
  ProtocolInputMode,
  ProtocolRequestLog,
  ProtocolRow,
} from "@/lib/contracts/types";

export const runtime = "nodejs";

type AiResult = {
  summary?: string;
  recommendation?: string;
  rows?: ProtocolRow[];
  comments?: ProtocolComment[];
};

const allowedModes: ProtocolInputMode[] = [
  "client-freeform",
  "client-points",
  "client-protocol",
  "edited-template",
  "protocol-sync",
];

function extractDocumentId(fileUrl: string): string | null {
  if (fileUrl.startsWith("/api/contracts/files/")) {
    return fileUrl.replace("/api/contracts/files/", "");
  }
  if (fileUrl.startsWith("/api/knowledge/files/")) {
    return fileUrl.replace("/api/knowledge/files/", "");
  }
  return null;
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeComparable(value: string): string {
  return normalizeSpace(value).toLowerCase();
}

function parseMode(value: string): ProtocolInputMode {
  return allowedModes.includes(value as ProtocolInputMode)
    ? (value as ProtocolInputMode)
    : "client-points";
}

function normalizeRow(row: Partial<ProtocolRow>): ProtocolRow {
  return {
    clause: normalizeSpace(String(row.clause ?? "")),
    clientText: normalizeSpace(String(row.clientText ?? "")),
    ourText: normalizeSpace(String(row.ourText ?? "")),
    agreedText: normalizeSpace(String(row.agreedText ?? "")),
  };
}

function mergeText(current: string, next: string): string {
  return normalizeSpace(next) || normalizeSpace(current);
}

function rowSignature(row: ProtocolRow): string {
  return [
    normalizeComparable(row.clause),
    normalizeComparable(row.clientText),
    normalizeComparable(row.ourText ?? ""),
    normalizeComparable(row.agreedText ?? ""),
  ].join("||");
}

function isMeaningfulRow(row: ProtocolRow): boolean {
  return Boolean(
    normalizeSpace(row.clause) ||
      normalizeSpace(row.clientText) ||
      normalizeSpace(row.ourText ?? "") ||
      normalizeSpace(row.agreedText ?? ""),
  );
}

function mergeTwoRows(current: ProtocolRow, incoming: ProtocolRow): ProtocolRow {
  return {
    clause: mergeText(current.clause, incoming.clause),
    clientText: mergeText(current.clientText, incoming.clientText),
    ourText: mergeText(current.ourText ?? "", incoming.ourText ?? ""),
    agreedText: mergeText(current.agreedText ?? "", incoming.agreedText ?? ""),
  };
}

function canReplaceClientText(current: ProtocolRow, incoming: ProtocolRow): boolean {
  const currentText = normalizeComparable(current.clientText);
  const incomingText = normalizeComparable(incoming.clientText);

  if (!incomingText) return false;
  if (!currentText) return true;
  if (currentText === incomingText) return true;

  const hasOurText = Boolean(normalizeComparable(current.ourText ?? ""));
  const hasAgreedText = Boolean(normalizeComparable(current.agreedText ?? ""));

  return !hasOurText && !hasAgreedText;
}

function dedupeRows(rows: ProtocolRow[]): ProtocolRow[] {
  const map = new Map<string, ProtocolRow>();

  for (const row of rows.map(normalizeRow)) {
    if (!isMeaningfulRow(row)) continue;

    const signature = rowSignature(row);
    const previous = map.get(signature);

    if (!previous) {
      map.set(signature, row);
      continue;
    }

    map.set(signature, mergeTwoRows(previous, row));
  }

  return Array.from(map.values());
}

function mergeRows(existingRows: ProtocolRow[], incomingRows: ProtocolRow[]): ProtocolRow[] {
  const result = existingRows.map(normalizeRow);

  for (const rawRow of incomingRows) {
    const incoming = normalizeRow(rawRow);
    if (!isMeaningfulRow(incoming)) continue;

    const exactIndex = result.findIndex((row) => rowSignature(row) === rowSignature(incoming));
    if (exactIndex >= 0) {
      result[exactIndex] = mergeTwoRows(result[exactIndex], incoming);
      continue;
    }

    const sameClauseIndexes = incoming.clause
      ? result.reduce<number[]>((acc, row, index) => {
          if (normalizeComparable(row.clause) === normalizeComparable(incoming.clause)) {
            acc.push(index);
          }
          return acc;
        }, [])
      : [];

    if (sameClauseIndexes.length === 1) {
      const index = sameClauseIndexes[0];
      const current = result[index];
      const sameClientText =
        normalizeComparable(current.clientText) === normalizeComparable(incoming.clientText);

      if (sameClientText || canReplaceClientText(current, incoming)) {
        result[index] = {
          clause: mergeText(current.clause, incoming.clause),
          clientText: canReplaceClientText(current, incoming)
            ? mergeText(current.clientText, incoming.clientText)
            : current.clientText,
          ourText: mergeText(current.ourText ?? "", incoming.ourText ?? ""),
          agreedText: mergeText(current.agreedText ?? "", incoming.agreedText ?? ""),
        };
        continue;
      }
    }

    const sameClientIndex = incoming.clientText
      ? result.findIndex(
          (row) => normalizeComparable(row.clientText) === normalizeComparable(incoming.clientText),
        )
      : -1;

    if (sameClientIndex >= 0) {
      result[sameClientIndex] = mergeTwoRows(result[sameClientIndex], incoming);
      continue;
    }

    result.push(incoming);
  }

  return dedupeRows(result);
}

function normalizeComment(
  item: Partial<ProtocolComment>,
  fallbackIndex: number,
): ProtocolComment {
  const severity =
    item.severity === "critical" || item.severity === "moderate" || item.severity === "minor"
      ? item.severity
      : "minor";

  return {
    id: normalizeSpace(String(item.id ?? "")) || String(fallbackIndex),
    clause: normalizeSpace(String(item.clause ?? "")),
    was: normalizeSpace(String(item.was ?? "")),
    now: normalizeSpace(String(item.now ?? "")),
    severity,
    comment: normalizeSpace(String(item.comment ?? "")),
    guidance: normalizeSpace(String(item.guidance ?? "")),
  };
}

function commentPriority(value: ProtocolComment["severity"]): number {
  if (value === "critical") return 3;
  if (value === "moderate") return 2;
  return 1;
}

function commentKey(item: ProtocolComment): string {
  return [
    normalizeComparable(item.clause),
    normalizeComparable(item.now),
    normalizeComparable(item.comment),
  ].join("||");
}

function mergeComments(
  existingComments: ProtocolComment[],
  incomingComments: ProtocolComment[],
): ProtocolComment[] {
  const map = new Map<string, ProtocolComment>();

  for (const [index, raw] of [...existingComments, ...incomingComments].entries()) {
    const comment = normalizeComment(raw, index);
    if (!comment.clause && !comment.was && !comment.now && !comment.comment) continue;

    const key = commentKey(comment);
    const previous = map.get(key);

    if (!previous) {
      map.set(key, comment);
      continue;
    }

    map.set(key, {
      id: previous.id || comment.id,
      clause: mergeText(previous.clause, comment.clause),
      was: mergeText(previous.was, comment.was),
      now: mergeText(previous.now, comment.now),
      severity:
        commentPriority(comment.severity) > commentPriority(previous.severity)
          ? comment.severity
          : previous.severity,
      comment: mergeText(previous.comment, comment.comment),
      guidance: mergeText(previous.guidance ?? "", comment.guidance ?? ""),
    });
  }

  return Array.from(map.values());
}

async function extractText(buffer: Buffer, fileName: string): Promise<string> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "docx") {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || "";
    } catch {
      return "";
    }
  }

  if (ext === "pdf") {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy();
      return result.text || "";
    } catch {
      return "";
    }
  }

  if (ext === "txt") {
    return buffer.toString("utf-8");
  }

  return "";
}

async function readPrompt(): Promise<string> {
  const filePath = path.join(process.cwd(), "src", "prompts", "protocol-system.txt");
  return fs.readFile(filePath, "utf-8");
}

async function callAi(input: {
  system: string;
  mode: ProtocolInputMode;
  templateText: string;
  existingRows: ProtocolRow[];
  existingProtocolText: string;
  newInputText: string;
  rulesText: string;
  lawsText: string;
  requestHistory: ProtocolRequestLog[];
}): Promise<AiResult | null> {
  const apiKey =
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.PLATFORM_OPENAI_API_KEY ||
    "";

  if (!apiKey) {
    return null;
  }

  const baseUrl =
    process.env.AI_API_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const userPayload = {
    mode: input.mode,
    template: input.templateText.slice(0, 12000),
    existingRows: input.existingRows,
    existingProtocolText: input.existingProtocolText.slice(0, 12000),
    newInputText: input.newInputText.slice(0, 12000),
    rulesText: input.rulesText.slice(0, 12000),
    lawsText: input.lawsText.slice(0, 12000),
    requestHistory: input.requestHistory.slice(-10),
  };

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content) as AiResult;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const scope = { tenantId: user.id, agentId: "jurist3-agent" };
    const formData = await request.formData();

    const contractId = String(formData.get("contractId") || "").trim();
    const mode = parseMode(String(formData.get("mode") || "").trim());
    const message = String(formData.get("message") || "").trim();
    const file = formData.get("file") as File | null;

    if (!contractId) {
      return NextResponse.json({ error: "missing contractId" }, { status: 400 });
    }

    const contracts = await getStore<any[]>("contracts_store", scope);
    const list = Array.isArray(contracts) ? contracts : [];
    const contract = list.find((item) => item?.id === contractId);

    if (!contract) {
      return NextResponse.json({ error: "contract not found" }, { status: 404 });
    }

    const templateDocId = extractDocumentId(contract.templateFileUrl || "") || contract.templateDocId;

    let templateText = "";
    if (templateDocId) {
      const templateDoc = await getDocument(templateDocId, scope);
      if (templateDoc) {
        templateText = await extractText(templateDoc.buffer, templateDoc.fileName);
      }
    }

    let rulesText = "";
    let lawsText = "";

    const knowledge = await getStore<any[]>("knowledge_store", scope);
    if (Array.isArray(knowledge)) {
      const rulesDocs = knowledge.filter((item) => item?.section === "rules" && item?.fileUrl);
      const lawsDocs = knowledge.filter((item) => item?.section === "laws" && item?.fileUrl);

      const rulesDocId = rulesDocs.length > 0 ? extractDocumentId(rulesDocs[0].fileUrl || "") : null;
      const lawsDocId = lawsDocs.length > 0 ? extractDocumentId(lawsDocs[0].fileUrl || "") : null;

      if (rulesDocId) {
        const doc = await getDocument(rulesDocId, scope);
        if (doc) {
          rulesText = await extractText(doc.buffer, doc.fileName);
        }
      }

      if (lawsDocId) {
        const doc = await getDocument(lawsDocId, scope);
        if (doc) {
          lawsText = await extractText(doc.buffer, doc.fileName);
        }
      }
    }

    let newInputText = message;

    if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const fileText = await extractText(buffer, file.name);
      newInputText = [message, fileText].filter(Boolean).join("\n\n");
    }

    if (!newInputText.trim()) {
      return NextResponse.json({ error: "empty input" }, { status: 400 });
    }

    const existingRows = Array.isArray(contract.protocolRows)
      ? (contract.protocolRows as ProtocolRow[])
      : [];

    const existingComments = Array.isArray(contract.protocolComments)
      ? (contract.protocolComments as ProtocolComment[])
      : [];

    const requestHistory = Array.isArray(contract.protocolRequests)
      ? (contract.protocolRequests as ProtocolRequestLog[])
      : [];

    let existingProtocolText = "";
    const protocolDocId = extractDocumentId(contract.protocolFileUrl || "");

    if (protocolDocId) {
      const protocolDoc = await getDocument(protocolDocId, scope);
      if (protocolDoc) {
        existingProtocolText = await extractText(protocolDoc.buffer, protocolDoc.fileName);
      }
    }

    const systemPrompt = await readPrompt();

    const aiResult = await callAi({
      system: systemPrompt,
      mode,
      templateText,
      existingRows,
      existingProtocolText,
      newInputText,
      rulesText,
      lawsText,
      requestHistory,
    });

    if (
      !aiResult ||
      (!Array.isArray(aiResult.rows) && !Array.isArray(aiResult.comments))
    ) {
      return NextResponse.json({ error: "ai_failed" }, { status: 500 });
    }

    const normalizedIncomingRows = Array.isArray(aiResult.rows)
      ? aiResult.rows.map(normalizeRow)
      : [];

    const normalizedIncomingComments = Array.isArray(aiResult.comments)
      ? aiResult.comments.map((item, index) => normalizeComment(item, index))
      : [];

    const mergedRows = mergeRows(existingRows, normalizedIncomingRows);
    const mergedComments = mergeComments(existingComments, normalizedIncomingComments);

    const now = new Date().toISOString();

    const logEntry: ProtocolRequestLog = {
      id: randomUUID(),
      mode,
      text: normalizeSpace(newInputText),
      fileName: file?.name || undefined,
      fileType: file?.type || undefined,
      createdAt: now,
      summary: normalizeSpace(String(aiResult.summary || "")) || undefined,
    };

    const updated = list.map((item) => {
      if (!item || item.id !== contractId) return item;

      return {
        ...item,
        protocolRows: mergedRows,
        protocolComments: mergedComments,
        protocolSummary: normalizeSpace(String(aiResult.summary || "")),
        protocolRecommendation: normalizeSpace(String(aiResult.recommendation || "")),
        protocolUpdatedAt: now,
        protocolRequests: [...requestHistory, logEntry].slice(-20),
      };
    });

    await setStore("contracts_store", scope, updated);

    return NextResponse.json({
      ok: true,
      rows: mergedRows,
      comments: mergedComments,
      summary: normalizeSpace(String(aiResult.summary || "")),
      recommendation: normalizeSpace(String(aiResult.recommendation || "")),
      logEntry,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    if (message.includes("UNAUTHORIZED")) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}