import mammoth from "mammoth";
import PizZip from "pizzip";
import { NextResponse } from "next/server";
import { getDocument, saveDocument } from "@/lib/documents";
import { getStore, setStore } from "@/lib/storage-server";
import { requireSessionUser } from "@/lib/auth";
import { fillTemplate, loadPrompt } from "@/lib/prompts";

export const runtime = "nodejs";

type InputDoc = {
  fileName: string;
  fileUrl: string;
};

type GenerateRequest = {
  contractId?: string;
  iterationId?: string;
  requestText?: string;
  attachments?: InputDoc[];
  template?: InputDoc | null;
  contractTemplate?: InputDoc | null;
};

type AiPointsResult = {
  points: string[];
  ourRole?: string;
  clientRole?: string;
};

type ClientPoint = {
  clause: string;
  text: string;
};

type StoredAttachment = {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
};

function splitClientPoints(requestText: string): string[] {
  const normalized = requestText
    .replace(/\r/g, "\n")
    .replace(/(\d+\.\d+(?:\.\d+)*)\s+/g, "\n$1 ")
    .replace(/(\d+\.\d+(?:\.\d+)*)(?=\S)/g, "$1 ")
    .trim();

  if (!normalized) {
    return [];
  }

  const chunks = normalized
    .split(/\n(?=\d+\.\d+(?:\.\d+)*\s)/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (chunks.length > 0) {
    return chunks.slice(0, 20);
  }

  return normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function parseNumberedPoints(requestText: string): ClientPoint[] {
  const normalized = requestText.replace(/\r/g, "\n");
  const regex = /(\d+\.\d+(?:\.\d+)*)([\s\S]*?)(?=\n?\d+\.\d+(?:\.\d+)*\s|$)/g;
  const points: ClientPoint[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(normalized)) !== null) {
    const clause = match[1]?.trim() || "";
    const text = (match[2] || "").replace(/\s+/g, " ").trim();
    if (!clause || !text) {
      continue;
    }
    points.push({ clause, text });
  }
  return points;
}

function normalizeRequestText(value: string): string {
  return value
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) {
        return false;
      }
      const lower = line.toLowerCase();
      if (lower === "пожелания по договору" || lower === "пожелания по договору:") {
        return false;
      }
      if (lower === "request" || lower === "request:") {
        return false;
      }
      return true;
    })
    .join("\n");
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

function trimText(value: string, max = 7000): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n...[truncated]`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toWordXmlMultiline(value: string): string {
  const escaped = xmlEscape(value);
  return escaped.replace(/\r?\n/g, "</w:t><w:br/><w:t>");
}

function extractCellText(cellXml: string): string {
  const textParts = Array.from(cellXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)).map((m) => m[1]);
  return textParts.join("").replace(/\s+/g, " ").trim();
}

function extractTableRows(xml: string): string[][] {
  const tableMatch = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/);
  if (!tableMatch) {
    return [];
  }

  const rows = tableMatch[0].match(/<w:tr[\s\S]*?<\/w:tr>/g);
  if (!rows) {
    return [];
  }

  return rows.map((row) => {
    const cells = row.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
    return cells.map((cell) => extractCellText(cell));
  });
}

async function extractProtocolPointsFromDocx(buffer: Buffer): Promise<string[] | null> {
  try {
    const zip = new PizZip(buffer);
    const documentFile = zip.file("word/document.xml");
    if (!documentFile) {
      return null;
    }

    const xml = documentFile.asText();
    const rows = extractTableRows(xml);
    if (rows.length < 2) {
      return null;
    }

    const header = rows[0].map((cell) => cell.toLowerCase());
    const pointIdx = header.findIndex((cell) => cell.includes("пункт договора") || cell.includes("пункт"));
    const buyerIdx = header.findIndex(
      (cell) => cell.includes("редакция покупателя") || cell.includes("редакция клиента") || cell.includes("клиента"),
    );

    if (pointIdx === -1 || buyerIdx === -1) {
      return null;
    }

    const points = rows.slice(1).map((row) => {
      const clause = row[pointIdx] || "";
      const buyer = row[buyerIdx] || "";
      if (!clause && !buyer) {
        return "";
      }
      if (clause && buyer) {
        return `${clause}. ${buyer}`.trim();
      }
      return (buyer || clause).trim();
    });

    const filtered = points.filter(Boolean);
    return filtered.length > 0 ? filtered : null;
  } catch {
    return null;
  }
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

async function callCompatibleChat(prompt: string): Promise<string | null> {
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
    return null;
  }

  const systemPrompt = await loadPrompt("generate-disagreement-system.txt");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: systemPrompt.trim(),
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return payload.choices?.[0]?.message?.content?.trim() || null;
}

async function callPointsWithRoles(prompt: string): Promise<AiPointsResult | null> {
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
    return null;
  }

  const systemPrompt = await loadPrompt("generate-disagreement-points-system.txt");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemPrompt.trim(),
        },
        { role: "user", content: prompt },
      ],
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
    const parsed = JSON.parse(content) as AiPointsResult;
    if (!Array.isArray(parsed.points)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function buildFallbackProtocol(
  templateText: string,
  requestText: string,
  attachmentChunks: Array<{ fileName: string; excerpt: string }>,
): string {
  const header = templateText.trim() || "ПРОТОКОЛ РАЗНОГЛАСИЙ";
  const explicitPoints = splitClientPoints(requestText);
  const explicitRows =
    explicitPoints.length > 0
      ? explicitPoints
          .map(
            (point, index) =>
              `${index + 1}. Источник: текст клиента\nРедакция/пожелание клиента:\n${trimText(point, 2200)}\n`,
          )
          .join("\n")
      : "";
  const rows = attachmentChunks.length
    ? attachmentChunks
        .map(
          (item, index) =>
            `${index + 1}. Источник: ${item.fileName}\n` +
            `Редакция/пожелание клиента:\n${trimText(item.excerpt || "(не извлечено)", 2200)}\n`,
        )
        .join("\n")
    : explicitRows ||
      "1. Источник: текст клиента\nРедакция/пожелание клиента:\n" +
      (requestText || "(не указано)");

  return (
    `${header}\n\n` +
    "Раздел: Позиция клиента по спорным пунктам\n\n" +
    rows +
    "\nПримечание: документ сформирован автоматически, требует юридической верификации."
  );
}

function extractClauseTitle(point: string): string {
  const match = point.match(/(\d+\.\d+(?:\.\d+)*)/);
  return match ? match[1] : "";
}

function setCellText(cellXml: string, text: string): string {
  const content = `<w:p><w:r><w:t xml:space="preserve">${toWordXmlMultiline(text)}</w:t></w:r></w:p>`;
  const startIdx = cellXml.indexOf(">" );
  const endIdx = cellXml.lastIndexOf("</w:tc>");
  if (startIdx === -1 || endIdx === -1) {
    return cellXml;
  }
  return `${cellXml.slice(0, startIdx + 1)}${content}${cellXml.slice(endIdx)}`;
}

function fillProtocolTable(xml: string, points: ClientPoint[]): string | null {
  const tableMatch = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/);
  if (!tableMatch) {
    return null;
  }

  const tableXml = tableMatch[0];
  const rows = tableXml.match(/<w:tr[\s\S]*?<\/w:tr>/g);
  if (!rows || rows.length < 2) {
    return null;
  }

  const headerRow = rows[0];
  const templateRow = rows[1];
  const cells = templateRow.match(/<w:tc[\s\S]*?<\/w:tc>/g);
  if (!cells || cells.length < 4) {
    return null;
  }

  const filledRows = points.map((point) => {
    const nextCells = [...cells];
    nextCells[0] = setCellText(nextCells[0], point.clause);
    nextCells[1] = setCellText(nextCells[1], point.text);
    nextCells[2] = setCellText(nextCells[2], "");
    nextCells[3] = setCellText(nextCells[3], "");

    return templateRow.replace(/<w:tc[\s\S]*?<\/w:tc>/g, () => nextCells.shift() || "");
  });

  const newTable = [headerRow, ...filledRows].join("");
  const updated = xml.replace(tableXml, newTable);
  return updated;
}

function buildCell(text: string): string {
  return `<w:tc><w:tcPr/><w:p><w:r><w:t xml:space="preserve">${toWordXmlMultiline(
    text,
  )}</w:t></w:r></w:p></w:tc>`;
}

function buildRow(cells: string[]): string {
  return `<w:tr>${cells.map((cell) => buildCell(cell)).join("")}</w:tr>`;
}

function buildTableBorders(): string {
  return `<w:tblPr><w:tblBorders>
    <w:top w:val="single" w:sz="8" w:space="0" w:color="auto"/>
    <w:left w:val="single" w:sz="8" w:space="0" w:color="auto"/>
    <w:bottom w:val="single" w:sz="8" w:space="0" w:color="auto"/>
    <w:right w:val="single" w:sz="8" w:space="0" w:color="auto"/>
    <w:insideH w:val="single" w:sz="6" w:space="0" w:color="auto"/>
    <w:insideV w:val="single" w:sz="6" w:space="0" w:color="auto"/>
  </w:tblBorders></w:tblPr>`;
}

function buildDocumentXml(points: ClientPoint[], headerLabels: string[]): string {
  const rows: string[] = [];
  rows.push(buildRow(headerLabels));
  if (points.length === 0) {
    rows.push(buildRow(["", "", "", ""]));
  } else {
    points.forEach((point) => {
      rows.push(buildRow([point.clause, point.text, "", ""]));
    });
  }

  const tableXml = `<w:tbl>${buildTableBorders()}${rows.join("")}</w:tbl>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">ПРОТОКОЛ РАЗНОГЛАСИЙ</w:t></w:r></w:p>
    ${tableXml}
    <w:sectPr/>
  </w:body>
</w:document>`;
}

function buildBaseDocx(points: ClientPoint[], headerLabels: string[]): Buffer {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder("word")?.file("document.xml", buildDocumentXml(points, headerLabels));
  return zip.generate({ type: "nodebuffer" });
}

function mergeProtocolTable(xml: string, points: ClientPoint[]): string | null {
  const tableMatch = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/);
  if (!tableMatch) {
    return null;
  }

  const tableXml = tableMatch[0];
  const rows = tableXml.match(/<w:tr[\s\S]*?<\/w:tr>/g);
  if (!rows || rows.length < 2) {
    return null;
  }

  const headerCells = rows[0].match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
  const headerText = headerCells.map((cell) => extractCellText(cell).toLowerCase());
  const clauseIdx = headerText.findIndex((cell) => cell.includes("пункт"));
  const clientIdx = headerText.findIndex(
    (cell) => cell.includes("редакция клиента") || cell.includes("клиента") || cell.includes("покупателя"),
  );

  if (clauseIdx === -1 || clientIdx === -1) {
    return null;
  }

  const templateRow = rows[1];
  const existingRows = rows.slice(1);
  const existingClauseMap = new Map<string, number>();
  existingRows.forEach((rowXml, idx) => {
    const cells = rowXml.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
    if (cells.length === 0) {
      return;
    }
    const clause = extractCellText(cells[clauseIdx] || "");
    if (clause) {
      existingClauseMap.set(clause, idx);
    }
  });

  const updatedRows = [...existingRows];
  const appendedRows: string[] = [];

  points.forEach((point) => {
    const clause = point.clause;
    const rowIndex = existingClauseMap.get(clause);
    if (rowIndex !== undefined) {
      const rowXml = updatedRows[rowIndex];
      const cells = rowXml.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
      if (cells[clientIdx]) {
        cells[clientIdx] = setCellText(cells[clientIdx], point.text);
        updatedRows[rowIndex] = rowXml.replace(/<w:tc[\s\S]*?<\/w:tc>/g, () => cells.shift() || "");
      }
      return;
    }

    const cells = (templateRow.match(/<w:tc[\s\S]*?<\/w:tc>/g) || []).map((cell) => cell);
    if (cells.length < 4) {
      return;
    }
    cells[clauseIdx] = setCellText(cells[clauseIdx], clause);
    cells[clientIdx] = setCellText(cells[clientIdx], point.text);
    appendedRows.push(templateRow.replace(/<w:tc[\s\S]*?<\/w:tc>/g, () => cells.shift() || ""));
  });

  const tableHasBorders = tableXml.includes("<w:tblBorders");
  const tblPrMatch = tableXml.match(/<w:tblPr[\s\S]*?<\/w:tblPr>/);
  const tblGridMatch = tableXml.match(/<w:tblGrid[\s\S]*?<\/w:tblGrid>/);
  const prefix = [tblPrMatch ? tblPrMatch[0] : tableHasBorders ? "" : buildTableBorders(), tblGridMatch ? tblGridMatch[0] : ""].filter(Boolean).join("");
  const newTable = `<w:tbl>${prefix}${[rows[0], ...updatedRows, ...appendedRows].join("")}</w:tbl>`;
  return xml.replace(tableXml, newTable);
}

async function saveProtocolToContract(
  contractId: string | undefined,
  iterationId: string | undefined,
  attachment: StoredAttachment,
) {
  if (!contractId || !iterationId) {
    return;
  }
  const user = await requireSessionUser();
  const scope = { tenantId: user.id, agentId: "jurist3-agent" };
  const contracts = await getStore<any[]>("contracts_store", scope);
  if (!Array.isArray(contracts) || contracts.length === 0) {
    return;
  }
  const next = contracts.map((contract) => {
    if (!contract || contract.id !== contractId) {
      return contract;
    }
    const iterations = Array.isArray(contract.iterations) ? contract.iterations : [];
    const updatedIterations = iterations.map((iteration: any) => {
      if (!iteration || iteration.id !== iterationId) {
        return iteration;
      }
      const existing = Array.isArray(iteration.attachments) ? iteration.attachments : [];
      const withoutOldProtocol = existing.filter(
        (item: StoredAttachment) =>
          !item.fileName?.toLowerCase().includes("protocol") &&
          !item.fileName?.toLowerCase().includes("разноглас"),
      );
      return {
        ...iteration,
        attachments: [attachment, ...withoutOldProtocol],
      };
    });
    return { ...contract, iterations: updatedIterations };
  });
  await setStore("contracts_store", scope, next);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateRequest;
    const contractId = body.contractId;
    const iterationId = body.iterationId;
    const requestText = normalizeRequestText(body.requestText?.trim() || "");
    const attachments = body.attachments || [];
    const contractTemplate = body.contractTemplate;

    const contractTemplateText = contractTemplate
      ? await extractTextFromFile(contractTemplate.fileName, contractTemplate.fileUrl)
      : "";
    const attachmentChunks = await Promise.all(
      attachments.map(async (item) => ({
        fileName: item.fileName,
        excerpt: trimText(await extractTextFromFile(item.fileName, item.fileUrl), 3000),
      })),
    );

    const explicitPoints = splitClientPoints(requestText);
    const numberedPoints = parseNumberedPoints(requestText);
    let points: ClientPoint[] = [];
    if (numberedPoints.length > 0) {
      points = numberedPoints;
    } else if (explicitPoints.length > 0) {
      points = explicitPoints
        .map((point, index) => ({
          clause: extractClauseTitle(point) || `Пункт ${index + 1}`,
          text: point,
        }))
        .filter((point) => point.text.trim());
    } else {
      points = attachmentChunks.map((item, index) => ({
        clause: `Пункт ${index + 1}`,
        text: `Источник: ${item.fileName}\n${item.excerpt || "(не извлечено)"}`,
      }));
    }

    if (points.length === 0) {
      for (const attachment of attachments) {
        if (!attachment.fileName.toLowerCase().endsWith(".docx")) {
          continue;
        }
        const docId = extractDocumentId(attachment.fileUrl);
        if (!docId) {
          continue;
        }
        const user = await requireSessionUser();
        const document = await getDocument(docId, { tenantId: user.id, agentId: "jurist3-agent" });
        if (!document) {
          continue;
        }
        const protocolPoints = await extractProtocolPointsFromDocx(document.buffer);
        if (protocolPoints && protocolPoints.length > 0) {
          points = protocolPoints.map((point, index) => ({
            clause: extractClauseTitle(point) || `Пункт ${index + 1}`,
            text: point,
          }));
          break;
        }
      }
    }

    const promptTemplate = await loadPrompt("generate-disagreement-user.txt");
    const prompt = fillTemplate(promptTemplate, {
      contractTemplateText: contractTemplateText || "(нет)",
      requestText: requestText || "(нет)",
      attachmentChunksJson: JSON.stringify(attachmentChunks, null, 2),
    });

    const aiPoints = await callPointsWithRoles(prompt);
    if (aiPoints?.points?.length) {
      const filtered = aiPoints.points
        .map((point, index) => ({
          clause: extractClauseTitle(point) || `Пункт ${index + 1}`,
          text: point,
        }))
        .filter((point) => point.clause && point.text);
      if (filtered.length > 0) {
        points = filtered;
      }
    } else if (points.length === 0) {
      const generatedTextFallback =
        (await callCompatibleChat(prompt)) ??
        buildFallbackProtocol("", requestText, attachmentChunks);
      points = splitClientPoints(generatedTextFallback).map((point, index) => ({
        clause: extractClauseTitle(point) || `Пункт ${index + 1}`,
        text: point,
      }));
    }

    const generatedText = points.length > 0
      ? points.map((point, index) => `${index + 1}. ${point.clause} ${point.text}`.trim()).join("\n")
      : buildFallbackProtocol("", requestText, attachmentChunks);

    const protocolAttachment = attachments.find((item) => {
      const lower = item.fileName.toLowerCase();
      return lower.includes("разноглас") || lower.includes("protocol");
    });
    const protocolId = protocolAttachment ? extractDocumentId(protocolAttachment.fileUrl) : null;

    const fileName = `${crypto.randomUUID()}-protocol-disagreement.docx`;
    const headerLabels = [
      "Пункт договора",
      "Редакция клиента",
      "Редакция нашей стороны",
      "Согласованная редакция",
    ];

    if (protocolId) {
      const user = await requireSessionUser();
      const protocolDocument = await getDocument(protocolId, { tenantId: user.id, agentId: "jurist3-agent" });
      const buffer = protocolDocument?.buffer;
      if (buffer) {
        const zip = new PizZip(buffer);
        const documentFile = zip.file("word/document.xml");
        if (documentFile) {
          let xml = documentFile.asText();
          const merged = mergeProtocolTable(xml, points) ?? fillProtocolTable(xml, points);
          if (merged) {
            xml = merged;
            zip.file("word/document.xml", xml);
            const bufferOut = zip.generate({ type: "nodebuffer" });
            const user = await requireSessionUser();
            const tenantId = user.id;
            const agentId = "jurist3-agent";
            const docId = await saveDocument({
              tenantId,
              agentId,
              fileName,
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              buffer: bufferOut,
            });
            const fileUrl = `/api/contracts/files/${docId}`;
            await saveProtocolToContract(contractId, iterationId, {
              id: crypto.randomUUID(),
              fileName,
              fileUrl,
              fileSize: bufferOut.length,
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              uploadedAt: new Date().toISOString(),
            });
            return NextResponse.json({
              fileName,
              fileUrl,
              content: generatedText,
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            });
          }
        }
      }
    }

    const outputDocx = buildBaseDocx(points, headerLabels);
    const user = await requireSessionUser();
    const tenantId = user.id;
    const agentId = "jurist3-agent";
    const docId = await saveDocument({
      tenantId,
      agentId,
      fileName,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: outputDocx,
    });
    const fileUrl = `/api/contracts/files/${docId}`;
    await saveProtocolToContract(contractId, iterationId, {
      id: crypto.randomUUID(),
      fileName,
      fileUrl,
      fileSize: outputDocx.length,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      uploadedAt: new Date().toISOString(),
    });
    return NextResponse.json({
      fileName,
      fileUrl,
      content: generatedText,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("UNAUTHORIZED")) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to generate protocol", details: message }, { status: 500 });
  }
}
