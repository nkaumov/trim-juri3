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

    const contracts = await getStore<Record<string, unknown>[]>("contracts_store", scope);
    const list = Array.isArray(contracts) ? contracts : [];
    const contract = list.find((item) => item?.id === contractId);

    if (!contract) {
      return NextResponse.json({ error: "contract not found" }, { status: 404 });
    }

    const templateFileUrl = asString(contract.templateFileUrl);
    const fallbackTemplateDocId = asString(contract.templateDocId);
    const templateDocId = extractDocumentId(templateFileUrl) || fallbackTemplateDocId;

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

    const logEntry = engineResult.logEntry as ProtocolRequestLog;

    const updated = list.map((item) => {
      if (!item || item.id !== contractId) return item;

      return {
        ...item,
        protocolRows: engineResult.rows,
        protocolComments: engineResult.comments,
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
      comments: engineResult.comments,
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
