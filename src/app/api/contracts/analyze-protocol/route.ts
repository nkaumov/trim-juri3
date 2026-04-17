import { NextResponse } from "next/server";
import mammoth from "mammoth";
import PizZip from "pizzip";
import { requireSessionUser } from "@/lib/auth";
import { getStore, setStore } from "@/lib/storage-server";
import { getDocument } from "@/lib/documents";
import type {
  ProtocolComment,
  ProtocolInputMode,
  ProtocolRequestLog,
  ProtocolRow,
} from "@/lib/contracts/types";
import { runProtocolEngine } from "@/lib/contracts/protocol-engine.mjs";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type AiResult = {
  summary?: string;
  recommendation?: string;
  rows?: ProtocolRow[];
  comments?: ProtocolComment[];
  logId?: string;
};

const allowedModes: ProtocolInputMode[] = [
  "client-freeform",
  "client-points",
  "client-protocol",
  "edited-template",
  "commented-template",
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

function parseMode(value: string): ProtocolInputMode {
  return allowedModes.includes(value as ProtocolInputMode)
    ? (value as ProtocolInputMode)
    : "client-points";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractClauseIds(text: string, limit = 40): string[] {
  const inputText = String(text || "");
  const matches = inputText.match(/\b\d+(?:\.\d+){1,}\b/g) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const clause = raw.replace(/\.+$/, "");
    if (!clause) continue;
    if (seen.has(clause)) continue;
    seen.add(clause);
    out.push(clause);
    if (out.length >= limit) break;
  }
  return out;
}

function buildTemplateClauseSnippets(
  templateText: string,
  clauses: string[],
  maxSnippetLen = 1800,
): Record<string, string> {
  const template = String(templateText || "");
  if (!template) return {};
  if (!Array.isArray(clauses) || clauses.length === 0) return {};

  const markerRegex = /\b(\d+(?:\.\d+){1,})\b/g;
  const markers: Array<{ clause: string; index: number }> = [];
  for (const match of template.matchAll(markerRegex)) {
    const clause = String(match[1] || "").replace(/\.+$/, "");
    const index = typeof match.index === "number" ? match.index : -1;
    if (clause && index >= 0) markers.push({ clause, index });
  }

  const byClause = new Map<string, Array<{ clause: string; index: number }>>();
  for (const m of markers) {
    const list = byClause.get(m.clause) || [];
    list.push(m);
    byClause.set(m.clause, list);
  }

  const result: Record<string, string> = {};
  for (const clause of clauses) {
    let start = -1;
    const hits = byClause.get(clause);
    if (hits && hits.length > 0) {
      start = hits[0].index;
    } else {
      const re = new RegExp(`\\b${escapeRegExp(clause)}\\b(?:\\s|\\.|\\)|:)`, "m");
      const m = re.exec(template);
      if (m && typeof m.index === "number") start = m.index;
    }
    if (start < 0) continue;

    let end = Math.min(template.length, start + maxSnippetLen);
    for (const m of markers) {
      if (m.index > start) {
        end = Math.min(m.index, start + maxSnippetLen);
        break;
      }
    }
    const snippet = template.slice(start, end).trim();
    if (snippet) result[clause] = snippet;
  }
  return result;
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

function extractDocxComments(buffer: Buffer): string[] {
  try {
    const zip = new PizZip(buffer);
    const commentsXml = zip.file("word/comments.xml");
    if (!commentsXml) return [];
    const xml = commentsXml.asText();
    const comments: string[] = [];
    const commentBlocks = xml.match(/<w:comment[\s\S]*?<\/w:comment>/g) || [];
    for (const block of commentBlocks) {
      const texts = block.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) || [];
      const value = texts
        .map((text) => text.replace(/<[^>]+>/g, ""))
        .join("")
        .trim();
      if (value) comments.push(value);
    }
    return comments;
  } catch {
    return [];
  }
}

function normalizeSpace(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractDiffLines(templateText: string, fileText: string): string {
  const templateLines = templateText
    .split(/\r?\n/)
    .map((line) => normalizeSpace(line))
    .filter((line) => line.length > 6);
  const fileLines = fileText
    .split(/\r?\n/)
    .map((line) => normalizeSpace(line))
    .filter((line) => line.length > 6);

  const templateSet = new Set(templateLines.map((line) => line.toLowerCase()));
  const diffLines: string[] = [];

  for (const line of fileLines) {
    const key = line.toLowerCase();
    if (!templateSet.has(key)) {
      diffLines.push(line);
    }
  }

  return diffLines.join("\n");
}

async function readPrompt(): Promise<string> {
  const filePath = path.join(process.cwd(), "src", "prompts", "protocol-system.txt");
  return fs.readFile(filePath, "utf-8");
}

async function callAi(input: {
  system: string;
  mode: ProtocolInputMode;
  templateText: string;
  templateClauses: string[];
  templateClauseSnippets: Record<string, string>;
  protocolColumnTitles?: { client: string; our: string; agreed: string } | null;
  currentDocumentText: string;
  existingRows: ProtocolRow[];
  existingComments: ProtocolComment[];
  existingSummary: string;
  existingRecommendation: string;
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

  function packLongText(value: string, limit: number): string {
    const text = String(value || "");
    if (text.length <= limit) return text;
    const head = text.slice(0, Math.floor(limit / 2));
    const tail = text.slice(-Math.ceil(limit / 2));
    return `${head}\n\n[...trimmed...]\n\n${tail}`;
  }

  const userPayload = {
    mode: input.mode,
    templateText: packLongText(input.templateText, 40000),
    templateClauses: Array.isArray(input.templateClauses) ? input.templateClauses.slice(0, 250) : [],
    templateClauseSnippets: input.templateClauseSnippets || {},
    protocolColumnTitles: input.protocolColumnTitles || null,
    currentDocumentText: packLongText(input.currentDocumentText, 20000),
    existingRows: input.existingRows,
    existingComments: input.existingComments,
    existingSummary: input.existingSummary,
    existingRecommendation: input.existingRecommendation,
    existingProtocolText: packLongText(input.existingProtocolText, 12000),
    newInputText: packLongText(input.newInputText, 12000),
    rulesText: packLongText(input.rulesText, 12000),
    lawsText: packLongText(input.lawsText, 12000),
    requestHistory: input.requestHistory.slice(-20),
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

    const contracts = await getStore<Record<string, unknown>[]>("contracts_store", scope);
    const list = Array.isArray(contracts) ? contracts : [];
    const contract = list.find((item) => item?.id === contractId);

    if (!contract) {
      return NextResponse.json({ error: "contract not found" }, { status: 404 });
    }

    const templateDocId =
      extractDocumentId(asString(contract.templateFileUrl)) || asString(contract.templateDocId);

    let templateText = "";
    if (templateDocId) {
      const templateDoc = await getDocument(templateDocId, scope);
      if (templateDoc) {
        templateText = await extractText(templateDoc.buffer, templateDoc.fileName);
      }
    }

    let rulesText = "";
    let lawsText = "";

    const knowledge = await getStore<Record<string, unknown>[]>("knowledge_store", scope);
    if (Array.isArray(knowledge)) {
      const rulesDocs = knowledge.filter((item) => item?.section === "rules" && item?.fileUrl);
      const lawsDocs = knowledge.filter((item) => item?.section === "laws" && item?.fileUrl);

      const rulesDocId =
        rulesDocs.length > 0 ? extractDocumentId(asString(rulesDocs[0].fileUrl)) : null;
      const lawsDocId =
        lawsDocs.length > 0 ? extractDocumentId(asString(lawsDocs[0].fileUrl)) : null;

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
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const commentText = ext === "docx" ? extractDocxComments(buffer).join("\n") : "";
      if (mode === "edited-template") {
        const diffText = templateText ? extractDiffLines(templateText, fileText) : fileText;
        newInputText = [message, diffText].filter(Boolean).join("\n\n");
      } else if (mode === "commented-template") {
        const normalizedComments = commentText || fileText;
        newInputText = [message, normalizedComments ? `Document comments:\n${normalizedComments}` : ""]
          .filter(Boolean)
          .join("\n\n");
      } else {
        newInputText = [message, fileText].filter(Boolean).join("\n\n");
      }
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
    const protocolDocId = extractDocumentId(asString(contract.protocolFileUrl));

    if (protocolDocId) {
      const protocolDoc = await getDocument(protocolDocId, scope);
      if (protocolDoc) {
        existingProtocolText = await extractText(protocolDoc.buffer, protocolDoc.fileName);
      }
    }

    const systemPrompt = await readPrompt();

    const iterations = Array.isArray((contract as any).iterations)
      ? ((contract as any).iterations as Array<{ content?: unknown }>)
      : [];
    const currentDocumentText =
      iterations.length > 0 ? asString(iterations[iterations.length - 1]?.content) : "";

    const clauseIds = extractClauseIds(
      [
        newInputText,
        ...existingRows.map((row) => row?.clause || ""),
        ...existingComments.map((comment) => comment?.clause || ""),
      ].join("\n"),
    );
    const templateClauses = extractClauseIds(templateText, 250);
    const templateClauseSnippets = buildTemplateClauseSnippets(templateText, clauseIds);

    const aiResult = await callAi({
      system: systemPrompt,
      mode,
      templateText,
      templateClauses,
      templateClauseSnippets,
      protocolColumnTitles: (contract as any).protocolColumnTitles || null,
      currentDocumentText,
      existingRows,
      existingComments,
      existingSummary: normalizeSpace(asString((contract as any).protocolSummary)),
      existingRecommendation: normalizeSpace(asString((contract as any).protocolRecommendation)),
      existingProtocolText,
      newInputText,
      rulesText,
      lawsText,
      requestHistory,
    });

    const engineResult = await runProtocolEngine({
      mode,
      templateText,
      existingRows,
      existingComments,
      existingProtocolText,
      newInputText,
      rulesText,
      lawsText,
      requestHistory,
      aiAdapter: async () => aiResult,
      mockAiResult: null,
      now: new Date().toISOString(),
    });

    if (!engineResult.usedAi) {
      return NextResponse.json({ error: "ai_failed" }, { status: 500 });
    }

    // Enforce two invariants server-side:
    // 1) comments must refer only to current rows
    // 2) comments.was should quote the template clause verbatim when possible
    const rowClauses = new Set(
      (engineResult.rows || [])
        .map((row) => normalizeSpace(String((row as any)?.clause || "")))
        .filter(Boolean),
    );

    const normalizedComments = (engineResult.comments || [])
      .filter((comment) => {
        const clause = normalizeSpace(String((comment as any)?.clause || ""));
        if (!clause) return true;
        return rowClauses.has(clause);
      })
      .map((comment) => {
        const clause = normalizeSpace(String((comment as any)?.clause || ""));
        const templateWas = clause ? templateClauseSnippets[clause] : "";
        if (!templateWas) return comment;
        return {
          ...comment,
          was: normalizeSpace(templateWas),
        };
      });

    const logEntry = engineResult.logEntry as ProtocolRequestLog;

    const updated = list.map((item) => {
      if (!item || item.id !== contractId) return item;

      return {
        ...item,
        protocolRows: engineResult.rows,
        protocolComments: normalizedComments,
        protocolSummary: engineResult.summary,
        protocolRecommendation: engineResult.recommendation,
        protocolUpdatedAt: logEntry.createdAt,
        protocolRequests: engineResult.requestHistory,
      };
    });

    await setStore("contracts_store", scope, updated);

    return NextResponse.json({
      ok: true,
      rows: engineResult.rows,
      comments: normalizedComments,
      summary: engineResult.summary,
      recommendation: engineResult.recommendation,
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
