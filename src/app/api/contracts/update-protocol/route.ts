import PizZip from "pizzip";
import { NextResponse } from "next/server";
import { getDocument, saveDocument } from "@/lib/documents";
import { getStore, setStore } from "@/lib/storage-server";
import { requireSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

type UpdateItem = {
  clause: string;
  ourText: string;
};

type UpdateRequest = {
  contractId?: string;
  iterationId?: string;
  protocolFileUrl: string;
  updates: UpdateItem[];
};

type StoredAttachment = {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
};

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
          !item.fileName?.toLowerCase().includes("СЂР°Р·РЅРѕРіР»Р°СЃ"),
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

function extractDocumentId(fileUrl: string): string | null {
  if (fileUrl.startsWith("/api/contracts/files/")) {
    return fileUrl.replace("/api/contracts/files/", "");
  }
  return null;
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

function normalizeClause(value: string): string {
  const match = value.match(/(\d+\.\d+(?:\.\d+)*)/);
  if (match) {
    return match[1];
  }
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function setCellText(cellXml: string, text: string): string {
  const content = `<w:p><w:r><w:t xml:space="preserve">${toWordXmlMultiline(text)}</w:t></w:r></w:p>`;
  const startIdx = cellXml.indexOf(">");
  const endIdx = cellXml.lastIndexOf("</w:tc>");
  if (startIdx === -1 || endIdx === -1) {
    return cellXml;
  }
  return `${cellXml.slice(0, startIdx + 1)}${content}${cellXml.slice(endIdx)}`;
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

function updateOurColumn(xml: string, updates: UpdateItem[]): string | null {
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
  const headerText = headerCells.map((cell) =>
    extractCellText(cell).toLowerCase().replace(/\s+/g, " ").trim(),
  );
const clauseIdx = headerText.findIndex((cell) => cell.includes("пункт"));
const ourIdx = headerText.findIndex((cell) => {
  if (!cell.includes("редакция")) {
    return false;
  }
  if (cell.includes("клиент") || cell.includes("покуп") || cell.includes("заказчик")) {
    return false;
  }
  if (cell.includes("согласован")) {
    return false;
  }
  return true;
});
if (clauseIdx === -1 || ourIdx === -1) {
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
    const clause = normalizeClause(extractCellText(cells[clauseIdx] || ""));
    if (clause) {
      existingClauseMap.set(clause, idx);
    }
  });

  const updatedRows = [...existingRows];
  const appendedRows: string[] = [];
  const updatedClauseSet = new Set<string>();

  updates.forEach((item) => {
    const clause = normalizeClause(item.clause.trim());
    if (!clause || !item.ourText.trim()) {
      return;
    }

    const rowIndex = existingClauseMap.get(clause);
    if (rowIndex !== undefined) {
      const rowXml = updatedRows[rowIndex];
      const cells = rowXml.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
      if (cells[ourIdx]) {
        cells[ourIdx] = setCellText(cells[ourIdx], item.ourText.trim());
        updatedRows[rowIndex] = rowXml.replace(/<w:tc[\s\S]*?<\/w:tc>/g, () => cells.shift() || "");
      }
      updatedClauseSet.add(clause);
      return;
    }

    const cells = (templateRow.match(/<w:tc[\s\S]*?<\/w:tc>/g) || []).map((cell) => cell);
    if (cells.length < 4) {
      return;
    }
    cells[clauseIdx] = setCellText(cells[clauseIdx], clause);
    cells[ourIdx] = setCellText(cells[ourIdx], item.ourText.trim());
    appendedRows.push(templateRow.replace(/<w:tc[\s\S]*?<\/w:tc>/g, () => cells.shift() || ""));
    updatedClauseSet.add(clause);
  });

  const filteredRows = updatedRows.filter((rowXml) => {
    const cells = rowXml.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
    const clause = normalizeClause(extractCellText(cells[clauseIdx] || ""));
    if (!clause) {
      return true;
    }
    if (updatedClauseSet.has(clause)) {
      return false;
    }
    return true;
  });

  const tblPrMatch = tableXml.match(/<w:tblPr[\s\S]*?<\/w:tblPr>/);
  const tblGridMatch = tableXml.match(/<w:tblGrid[\s\S]*?<\/w:tblGrid>/);
  const tableHasBorders = tableXml.includes("<w:tblBorders");
  const prefixParts = [
    tblPrMatch ? tblPrMatch[0] : tableHasBorders ? "" : buildTableBorders(),
    tblGridMatch ? tblGridMatch[0] : "",
  ].filter(Boolean);
  const prefix = prefixParts.join("");
  const newTable = `<w:tbl>${prefix}${[rows[0], ...filteredRows, ...appendedRows].join("")}</w:tbl>`;
  return xml.replace(tableXml, newTable);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as UpdateRequest;
    const contractId = body.contractId;
    const iterationId = body.iterationId;
    const protocolId = extractDocumentId(body.protocolFileUrl);
    if (!protocolId) {
      return NextResponse.json({ error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РїСѓС‚СЊ РїСЂРѕС‚РѕРєРѕР»Р°." }, { status: 400 });
    }

    const user = await requireSessionUser();
    const document = await getDocument(protocolId, { tenantId: user.id, agentId: "jurist3-agent" });
    if (!document) {
      return NextResponse.json({ error: "Р¤Р°Р№Р» РїСЂРѕС‚РѕРєРѕР»Р° РЅРµ РЅР°Р№РґРµРЅ." }, { status: 404 });
    }
    const buffer = document.buffer;
    const zip = new PizZip(buffer);
    const documentFile = zip.file("word/document.xml");
    if (!documentFile) {
      return NextResponse.json({ error: "Р¤Р°Р№Р» РїСЂРѕС‚РѕРєРѕР»Р° РїРѕРІСЂРµР¶РґРµРЅ." }, { status: 400 });
    }

    const xml = documentFile.asText();
    const updated = updateOurColumn(xml, body.updates || []);
    if (!updated) {
      return NextResponse.json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ С‚Р°Р±Р»РёС†Сѓ РїСЂРѕС‚РѕРєРѕР»Р°." }, { status: 400 });
    }

    zip.file("word/document.xml", updated);

    const fileName = `${crypto.randomUUID()}-protocol-disagreement.docx`;
    const bufferOut = zip.generate({ type: "nodebuffer" });
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
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("UNAUTHORIZED")) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
