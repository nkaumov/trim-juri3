import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { getDocument } from "@/lib/documents";
import { requireSessionUser } from "@/lib/auth";

type RoleExtraction = {
  ourRole?: string;
  counterpartyRole?: string;
  confidence?: "low" | "medium" | "high";
  notes?: string;
};

function extractDocumentId(fileUrl: string): string | null {
  if (!fileUrl.startsWith("/api/knowledge/files/")) {
    return null;
  }
  return fileUrl.replace("/api/knowledge/files/", "");
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

function heuristicRoles(text: string): RoleExtraction {
  const has = (word: string) => text.toLowerCase().includes(word);
  if (has("РёСЃРїРѕР»РЅРёС‚РµР»СЊ") && has("Р·Р°РєР°Р·С‡РёРє")) {
    return {
      ourRole: "РСЃРїРѕР»РЅРёС‚РµР»СЊ",
      counterpartyRole: "Р—Р°РєР°Р·С‡РёРє",
      confidence: "medium",
      notes: "РћРїСЂРµРґРµР»РµРЅРѕ РїРѕ РїР°СЂРµ РСЃРїРѕР»РЅРёС‚РµР»СЊ/Р—Р°РєР°Р·С‡РёРє.",
    };
  }
  if (has("РїРѕСЃС‚Р°РІС‰РёРє") && has("РїРѕРєСѓРїР°С‚РµР»СЊ")) {
    return {
      ourRole: "РџРѕСЃС‚Р°РІС‰РёРє",
      counterpartyRole: "РџРѕРєСѓРїР°С‚РµР»СЊ",
      confidence: "medium",
      notes: "РћРїСЂРµРґРµР»РµРЅРѕ РїРѕ РїР°СЂРµ РџРѕСЃС‚Р°РІС‰РёРє/РџРѕРєСѓРїР°С‚РµР»СЊ.",
    };
  }
  if (has("РїРѕРґСЂСЏРґС‡РёРє") && has("Р·Р°РєР°Р·С‡РёРє")) {
    return {
      ourRole: "РџРѕРґСЂСЏРґС‡РёРє",
      counterpartyRole: "Р—Р°РєР°Р·С‡РёРє",
      confidence: "medium",
      notes: "РћРїСЂРµРґРµР»РµРЅРѕ РїРѕ РїР°СЂРµ РџРѕРґСЂСЏРґС‡РёРє/Р—Р°РєР°Р·С‡РёРє.",
    };
  }
  if (has("Р°СЂРµРЅРґРѕРґР°С‚РµР»СЊ") && has("Р°СЂРµРЅРґР°С‚РѕСЂ")) {
    return {
      ourRole: "РђСЂРµРЅРґРѕРґР°С‚РµР»СЊ",
      counterpartyRole: "РђСЂРµРЅРґР°С‚РѕСЂ",
      confidence: "medium",
      notes: "РћРїСЂРµРґРµР»РµРЅРѕ РїРѕ РїР°СЂРµ РђСЂРµРЅРґРѕРґР°С‚РµР»СЊ/РђСЂРµРЅРґР°С‚РѕСЂ.",
    };
  }
  return {
    confidence: "low",
    notes: "РќРµ СѓРґР°Р»РѕСЃСЊ РѕРїСЂРµРґРµР»РёС‚СЊ СЂРѕР»Рё Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё.",
  };
}

async function callAiExtraction(text: string): Promise<RoleExtraction | null> {
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

  const prompt = `РўС‹ Р°РЅР°Р»РёР·РёСЂСѓРµС€СЊ С€Р°Р±Р»РѕРЅ РґРѕРіРѕРІРѕСЂР°. РќСѓР¶РЅРѕ РѕРїСЂРµРґРµР»РёС‚СЊ СЂРѕР»Рё СЃС‚РѕСЂРѕРЅ.
РџСЂР°РІРёР»Рѕ: "РјС‹" вЂ” РєРѕРјРїР°РЅРёСЏ, РёСЃРїРѕР»СЊР·СѓСЋС‰Р°СЏ СЃРёСЃС‚РµРјСѓ. РћР±С‹С‡РЅРѕ СЌС‚Рѕ РСЃРїРѕР»РЅРёС‚РµР»СЊ/РџРѕСЃС‚Р°РІС‰РёРє/РџРѕРґСЂСЏРґС‡РёРє.
Р’РµСЂРЅРё JSON СЃ РїРѕР»СЏРјРё: ourRole, counterpartyRole, confidence (low/medium/high), notes.
Р•СЃР»Рё РЅРµ СѓРІРµСЂРµРЅ вЂ” Р·Р°РїРѕР»РЅРё confidence=low Рё РєСЂР°С‚РєРѕ РѕР±СЉСЏСЃРЅРё РІ notes.
РўРµРєСЃС‚ РґРѕРіРѕРІРѕСЂР° (С„СЂР°РіРјРµРЅС‚):
${text.slice(0, 12000)}`;

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: "РўС‹ С‚РѕС‡РЅС‹Р№ РїР°СЂСЃРµСЂ СЋСЂРёРґРёС‡РµСЃРєРёС… РґРѕРєСѓРјРµРЅС‚РѕРІ." },
        { role: "user", content: prompt },
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
    const parsed = JSON.parse(content) as RoleExtraction;
    return parsed;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { fileUrl?: string; fileName?: string };
    const fileUrl = body.fileUrl?.trim();
    const fileName = body.fileName?.trim() || "template.docx";
    if (!fileUrl) {
      return NextResponse.json({ error: "fileUrl required" }, { status: 400 });
    }

    const documentId = extractDocumentId(fileUrl);
    if (!documentId) {
      return NextResponse.json({ error: "Unsupported fileUrl" }, { status: 400 });
    }
    const user = await requireSessionUser();
    const document = await getDocument(documentId, { tenantId: user.id, agentId: "jurist3-agent" });
    if (!document) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    const buffer = document.buffer;
    const text = await extractText(buffer, fileName);
    if (!text.trim()) {
      return NextResponse.json({
        confidence: "low",
        notes: "РќРµ СѓРґР°Р»РѕСЃСЊ РёР·РІР»РµС‡СЊ С‚РµРєСЃС‚ РёР· С„Р°Р№Р»Р° (РІРѕР·РјРѕР¶РЅРѕ, СЃРєР°РЅ РёР»Рё PDF Р±РµР· С‚РµРєСЃС‚Р°).",
      });
    }

    const apiKey =
      process.env.AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.PLATFORM_OPENAI_API_KEY ||
      "";
    const aiResult = apiKey ? await callAiExtraction(text) : null;
    const heuristic = heuristicRoles(text);
    const result = aiResult ?? heuristic;
    if (!aiResult && !apiKey) {
      result.notes = result.notes
        ? `${result.notes} РР РєР»СЋС‡ РЅРµ РЅР°СЃС‚СЂРѕРµРЅ, РёСЃРїРѕР»СЊР·РѕРІР°РЅР° СЌРІСЂРёСЃС‚РёРєР°.`
        : "РР РєР»СЋС‡ РЅРµ РЅР°СЃС‚СЂРѕРµРЅ, РёСЃРїРѕР»СЊР·РѕРІР°РЅР° СЌРІСЂРёСЃС‚РёРєР°.";
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

