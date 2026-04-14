import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { getStore, setStore } from "@/lib/storage-server";
import { getDocument } from "@/lib/documents";
import type { ProtocolRow, ProtocolComment } from "@/lib/contracts/types";
import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";

export const runtime = "nodejs";

type AiResult = {
  summary?: string;
  recommendation?: string;
  rows?: ProtocolRow[];
  comments?: ProtocolComment[];
};

function extractDocumentId(fileUrl: string): string | null {
  if (fileUrl.startsWith("/api/contracts/files/")) {
    return fileUrl.replace("/api/contracts/files/", "");
  }
  if (fileUrl.startsWith("/api/knowledge/files/")) {
    return fileUrl.replace("/api/knowledge/files/", "");
  }
  return null;
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
  templateText: string;
  existingRows: ProtocolRow[];
  existingProtocolText: string;
  newInputText: string;
  rulesText: string;
  lawsText: string;
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
    template: input.templateText.slice(0, 12000),
    existingRows: input.existingRows,
    existingProtocolText: input.existingProtocolText.slice(0, 12000),
    newInputText: input.newInputText.slice(0, 12000),
    rulesText: input.rulesText.slice(0, 12000),
    lawsText: input.lawsText.slice(0, 12000),
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

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
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

    const existingRows = Array.isArray(contract.protocolRows) ? contract.protocolRows : [];

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
      templateText,
      existingRows,
      existingProtocolText,
      newInputText,
      rulesText,
      lawsText,
    });

    if (!aiResult || !Array.isArray(aiResult.rows)) {
      return NextResponse.json({ error: "ai_failed" }, { status: 500 });
    }

    const normalizedRows = aiResult.rows.map((row) => ({
      clause: String(row.clause || "").trim(),
      clientText: String(row.clientText || "").trim(),
      ourText: "",
      agreedText: "",
    }));

    const normalizedComments = Array.isArray(aiResult.comments)
      ? aiResult.comments.map((item, index) => ({
          id: item.id || `${index}`,
          clause: String(item.clause || "").trim(),
          was: String(item.was || "").trim(),
          now: String(item.now || "").trim(),
          severity: item.severity || "minor",
          comment: String(item.comment || "").trim(),
          guidance: item.guidance ? String(item.guidance).trim() : "",
        }))
      : [];

    const now = new Date().toISOString();
    const updated = list.map((item) => {
      if (!item || item.id !== contractId) return item;
      return {
        ...item,
        protocolRows: normalizedRows,
        protocolComments: normalizedComments,
        protocolSummary: aiResult.summary || "",
        protocolRecommendation: aiResult.recommendation || "",
        protocolUpdatedAt: now,
      };
    });

    await setStore("contracts_store", scope, updated);

    return NextResponse.json({
      ok: true,
      rows: normalizedRows,
      comments: normalizedComments,
      summary: aiResult.summary || "",
      recommendation: aiResult.recommendation || "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("UNAUTHORIZED")) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
