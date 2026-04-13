import mammoth from "mammoth";
import { NextResponse } from "next/server";
import { getDocument } from "@/lib/documents";
import { requireSessionUser } from "@/lib/auth";
import { fillTemplate, loadPrompt } from "@/lib/prompts";

export const runtime = "nodejs";

type InputDoc = {
  section?: string;
  fileName: string;
  fileUrl: string;
};

type AnalyzeRequest = {
  contractTemplateName: string;
  contractTemplateFileUrl?: string;
  requestText?: string;
  attachments?: InputDoc[];
  knowledgeDocs?: InputDoc[];
};

type AiReviewItem = {
  section: string;
  severity: "critical" | "moderate" | "minor";
  was: string;
  now: string;
  aiComment: string;
};

function splitClientPoints(rawText: string): string[] {
  const normalized = rawText
    .replace(/\r/g, "\n")
    .replace(/(\d+\.\d+(?:\.\d+)*)\s+/g, "\n$1 ")
    .trim();

  if (!normalized) {
    return [];
  }

  const chunks = normalized
    .split(/\n(?=\d+\.\d+(?:\.\d+)*\s)/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (chunks.length > 0) {
    return chunks.slice(0, 12);
  }

  return normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function buildAttachmentText(chunks: Array<{ fileName: string; excerpt: string }>): string {
  if (chunks.length === 0) {
    return "";
  }
  return chunks
    .map((item) => `Источник: ${item.fileName}\n${item.excerpt || ""}`.trim())
    .join("\n\n");
}

function extractDocumentId(fileUrl: string): string | null {
  if (fileUrl.startsWith("/api/knowledge/files/")) {
    return fileUrl.replace("/api/knowledge/files/", "");
  }
  if (fileUrl.startsWith("/api/contracts/files/")) {
    return fileUrl.replace("/api/contracts/files/", "");
  }
  return null;
}

function trimText(value: string, max = 12000): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n...[truncated]`;
}

async function extractTextFromFile(fileName: string, fileUrl: string): Promise<string> {
  const documentId = extractDocumentId(fileUrl);
  if (!documentId) {
    return "";
  }

  const user = await requireSessionUser();
  const document = await getDocument(documentId, { tenantId: user.id, agentId: "jurist3-agent" });
  if (!document) {
    return "";
  }
  const buffer = document.buffer;

  const lower = fileName.toLowerCase();
  if (lower.endsWith(".docx")) {
    try {
      const extracted = await mammoth.extractRawText({ buffer });
      return extracted.value || "";
    } catch {
      return "";
    }
  }

  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".json") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".rtf")
  ) {
    try {
      return buffer.toString("utf-8");
    } catch {
      return "";
    }
  }

  return "";
}

function extractJsonObject(text: string): string {
  const cleaned = text.trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model response is not JSON object");
  }
  return cleaned.slice(start, end + 1);
}

async function callCompatibleChat(prompt: string): Promise<{ text: string; model?: string }> {
  const apiKey =
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.PLATFORM_OPENAI_API_KEY;
  const model =
    process.env.AI_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.PLATFORM_OPENAI_MODEL ||
    "gpt-4o-mini";
  const baseUrl = (
    process.env.AI_API_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    "https://api.openai.com/v1"
  ).replace(/\/$/, "");

  if (!apiKey) {
    throw new Error("AI API key is not configured");
  }

  const systemPrompt = await loadPrompt("analyze-iteration-system.txt");
  const messages = [
    {
      role: "system",
      content: systemPrompt.trim(),
    },
    {
      role: "user",
      content: prompt,
    },
  ];

  async function requestChatCompletion(useJsonResponseFormat: boolean) {
    const payload: Record<string, unknown> = {
      model,
      temperature: 0.1,
      messages,
    };
    if (useJsonResponseFormat) {
      payload.response_format = { type: "json_object" };
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI provider error: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("AI provider returned empty response");
    }

    return { text, model: data.model || model };
  }

  try {
    return await requestChatCompletion(true);
  } catch (error) {
    const details = error instanceof Error ? error.message : "";
    const shouldRetryWithoutJsonFormat =
      details.includes("response_format") ||
      details.includes("json_object") ||
      details.includes("unsupported") ||
      details.includes("not support");

    if (!shouldRetryWithoutJsonFormat) {
      throw error;
    }

    return requestChatCompletion(false);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AnalyzeRequest;
    const requestText = body.requestText?.trim() || "";

    const templateText = body.contractTemplateFileUrl
      ? await extractTextFromFile(body.contractTemplateName, body.contractTemplateFileUrl)
      : "";

    const attachments = body.attachments || [];
    const attachmentChunks = await Promise.all(
      attachments.map(async (item) => {
        const text = await extractTextFromFile(item.fileName, item.fileUrl);
        return {
          fileName: item.fileName,
          excerpt: trimText(text, 6000),
        };
      }),
    );

    const knowledgeDocs = (body.knowledgeDocs || []).filter(
      (item) => item.section === "rules" || item.section === "fz",
    );
    const knowledgeChunks = await Promise.all(
      knowledgeDocs.map(async (item) => {
        const text = await extractTextFromFile(item.fileName, item.fileUrl);
        return {
          section: item.section || "unknown",
          fileName: item.fileName,
          excerpt: trimText(text, 3500),
        };
      }),
    );
    const hasRulesOrLawKnowledge = knowledgeChunks.length > 0;

    const attachmentText = buildAttachmentText(attachmentChunks);
    const combinedText = requestText || attachmentText;
    const clientPoints = splitClientPoints(combinedText);
    const promptTemplate = await loadPrompt("analyze-iteration-user.txt");
    const prompt = fillTemplate(promptTemplate, {
      contractTemplateName: body.contractTemplateName,
      templateText: trimText(templateText, 12000) || "(template text not extracted)",
      combinedText: combinedText || "(нет текста, см. вложения)",
      clientPointsJson: JSON.stringify(clientPoints, null, 2),
      attachmentChunksJson: JSON.stringify(attachmentChunks, null, 2),
      knowledgeChunksJson: hasRulesOrLawKnowledge ? JSON.stringify(knowledgeChunks, null, 2) : "(не загружены)",
    });

    const modelResponse = await callCompatibleChat(prompt);
    const parsed = JSON.parse(extractJsonObject(modelResponse.text)) as {
      summary?: string;
      recommendation?: string;
      items?: AiReviewItem[];
    };

    let items = Array.isArray(parsed.items)
      ? parsed.items
          .map((item, index) => ({
            id: crypto.randomUUID(),
            section: String(item.section || `Пункт ${index + 1}`),
            severity:
              item.severity === "critical" || item.severity === "minor" ? item.severity : "moderate",
            was: String(item.was || ""),
            now: String(item.now || ""),
            aiComment: String(item.aiComment || ""),
          }))
          .slice(0, 12)
      : [];

    if (items.length > 1) {
      const seen = new Set<string>();
      items = items.filter((item) => {
        const key = `${item.section}|${item.was}|${item.now}|${item.aiComment}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    }

    if (clientPoints.length > items.length) {
      const existingByNow = new Set(items.map((item) => item.now.trim()).filter(Boolean));
      const fallbackItems = clientPoints
        .filter((point) => !existingByNow.has(point))
        .map((point, index) => ({
          id: crypto.randomUUID(),
          section: `Пункт ${items.length + index + 1}`,
          severity: "moderate" as const,
          was: "",
          now: point,
          aiComment: hasRulesOrLawKnowledge
            ? "Требует юридической проверки и формализации в протоколе. Источник: rules/fz"
            : "Требует юридической проверки и формализации в протоколе.",
        }));
      items = [...items, ...fallbackItems].slice(0, 12);
    }

    return NextResponse.json({
      summary: String(parsed.summary || "Анализ выполнен."),
      recommendation: String(parsed.recommendation || "Подготовьте протокол разногласий."),
      generatedAt: new Date().toISOString(),
      model: modelResponse.model,
      items,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : "unknown error";
    if (details.includes("UNAUTHORIZED")) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    return NextResponse.json(
      {
        error: "AI analysis failed",
        details,
      },
      { status: 502 },
    );
  }
}


