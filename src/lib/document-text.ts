import mammoth from "mammoth";
import PizZip from "pizzip";

export type DocumentTextBlockKind = "clause" | "paragraph" | "other";

export type DocumentTextBlock = {
  id: string;
  order: number;
  kind: DocumentTextBlockKind;
  clauseId?: string;
  text: string;
};

export type ExtractedDocumentText = {
  plain: string;
  blocks: DocumentTextBlock[];
};

function normalizeNewlines(value: string): string {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeSpaces(value: string): string {
  return String(value || "").replace(/[ \t]+/g, " ").trim();
}

function detectClauseId(line: string): string | null {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  const match = /^(\d+(?:\.\d+){1,})(?:\s*[\)\.]|\s+|$)/.exec(trimmed);
  if (!match) return null;
  const clause = String(match[1] || "").replace(/\.+$/, "");
  return clause || null;
}

export function splitTextIntoBlocks(input: string): DocumentTextBlock[] {
  const text = normalizeNewlines(input);
  const lines = text.split("\n");

  const blocks: DocumentTextBlock[] = [];
  let current: { kind: DocumentTextBlockKind; clauseId?: string; lines: string[] } | null = null;

  function pushCurrent() {
    if (!current) return;
    const joined = current.lines.join("\n").trim();
    if (!joined) {
      current = null;
      return;
    }
    const order = blocks.length;
    const idBase = current.kind === "clause" && current.clauseId ? `clause:${current.clauseId}` : `${current.kind}:${order}`;
    const id = blocks.some((b) => b.id === idBase) ? `${idBase}:${order}` : idBase;
    blocks.push({
      id,
      order,
      kind: current.kind,
      clauseId: current.clauseId,
      text: joined,
    });
    current = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, "");
    const normalized = normalizeSpaces(line);
    if (!normalized) {
      if (current) current.lines.push("");
      continue;
    }

    const clauseId = detectClauseId(normalized);
    if (clauseId) {
      pushCurrent();
      current = { kind: "clause", clauseId, lines: [normalized] };
      continue;
    }

    if (!current) {
      current = { kind: "paragraph", lines: [normalized] };
      continue;
    }

    current.lines.push(normalized);
  }

  pushCurrent();

  if (blocks.length === 0 && text.trim()) {
    return [
      {
        id: "paragraph:0",
        order: 0,
        kind: "paragraph",
        text: text.trim(),
      },
    ];
  }

  return blocks;
}

export async function extractPlainTextFromBuffer(buffer: Buffer, fileName: string): Promise<string> {
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

export async function extractDocumentText(buffer: Buffer, fileName: string): Promise<ExtractedDocumentText> {
  const plain = await extractPlainTextFromBuffer(buffer, fileName);
  return {
    plain,
    blocks: splitTextIntoBlocks(plain),
  };
}

export function extractDocxComments(buffer: Buffer): string[] {
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
