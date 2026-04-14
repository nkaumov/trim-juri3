import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { getStore } from "@/lib/storage-server";
import PizZip from "pizzip";

export const runtime = "nodejs";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatCell(text: string): string {
  const safe = escapeXml(text || "");
  const parts = safe.split(/\r?\n/);
  return parts
    .map((part, index) =>
      index === 0
        ? `<w:t>${part}</w:t>`
        : `<w:br/><w:t>${part}</w:t>`,
    )
    .join("");
}

function buildTable(rows: Array<{ clause: string; clientText: string; ourText?: string; agreedText?: string }>) {
  const header = ["Clause", "Client version", "Our version", "Agreed version"];
  const headerRow = `<w:tr>${header
    .map(
      (cell) =>
        `<w:tc><w:tcPr><w:tcW w:w=\"2500\" w:type=\"dxa\"/></w:tcPr><w:p><w:r>${formatCell(
          cell,
        )}</w:r></w:p></w:tc>`,
    )
    .join("")}</w:tr>`;

  const bodyRows = rows
    .map(
      (row) =>
        `<w:tr>` +
        `<w:tc><w:tcPr><w:tcW w:w=\"1600\" w:type=\"dxa\"/></w:tcPr><w:p><w:r>${formatCell(
          row.clause || "-",
        )}</w:r></w:p></w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w=\"3800\" w:type=\"dxa\"/></w:tcPr><w:p><w:r>${formatCell(
          row.clientText || "-",
        )}</w:r></w:p></w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w=\"3800\" w:type=\"dxa\"/></w:tcPr><w:p><w:r>${formatCell(
          row.ourText || "-",
        )}</w:r></w:p></w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w=\"3800\" w:type=\"dxa\"/></w:tcPr><w:p><w:r>${formatCell(
          row.agreedText || "-",
        )}</w:r></w:p></w:tc>` +
        `</w:tr>`,
    )
    .join("");

  const borders = `
    <w:tblBorders>
      <w:top w:val=\"single\" w:sz=\"8\" w:space=\"0\" w:color=\"000000\"/>
      <w:left w:val=\"single\" w:sz=\"8\" w:space=\"0\" w:color=\"000000\"/>
      <w:bottom w:val=\"single\" w:sz=\"8\" w:space=\"0\" w:color=\"000000\"/>
      <w:right w:val=\"single\" w:sz=\"8\" w:space=\"0\" w:color=\"000000\"/>
      <w:insideH w:val=\"single\" w:sz=\"6\" w:space=\"0\" w:color=\"000000\"/>
      <w:insideV w:val=\"single\" w:sz=\"6\" w:space=\"0\" w:color=\"000000\"/>
    </w:tblBorders>`;

  return `
    <w:tbl>
      <w:tblPr>${borders}</w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w=\"1600\"/>
        <w:gridCol w:w=\"3800\"/>
        <w:gridCol w:w=\"3800\"/>
        <w:gridCol w:w=\"3800\"/>
      </w:tblGrid>
      ${headerRow}
      ${bodyRows}
    </w:tbl>`;
}

function buildDocx(rows: Array<{ clause: string; clientText: string; ourText?: string; agreedText?: string }>) {
  const tableXml = buildTable(rows);
  const documentXml = `<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>
<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">
  <w:body>
    <w:p><w:r><w:t>Disagreement protocol</w:t></w:r></w:p>
    ${tableXml}
    <w:sectPr>
      <w:pgSz w:w=\"11906\" w:h=\"16838\"/>
      <w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const contentTypes = `<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>
<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">
  <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>
  <Default Extension=\"xml\" ContentType=\"application/xml\"/>
  <Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>
</Types>`;

  const rels = `<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">
  <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>
</Relationships>`;

  const zip = new PizZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.folder("_rels")?.file(".rels", rels);
  zip.folder("word")?.file("document.xml", documentXml);
  zip.folder("word")?.folder("_rels")?.file("document.xml.rels", "");
  return zip.generate({ type: "nodebuffer" });
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const scope = { tenantId: user.id, agentId: "jurist3-agent" };
    const url = new URL(request.url);
    const contractId = url.searchParams.get("contractId") || "";
    if (!contractId) {
      return NextResponse.json({ error: "missing contractId" }, { status: 400 });
    }

    const contracts = await getStore<any[]>("contracts_store", scope);
    const list = Array.isArray(contracts) ? contracts : [];
    const contract = list.find((item) => item?.id === contractId);
    if (!contract) {
      return NextResponse.json({ error: "contract not found" }, { status: 404 });
    }
    const rows = Array.isArray(contract.protocolRows) ? contract.protocolRows : [];
    const buffer = buildDocx(rows);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": "attachment; filename=protocol-disagreement.docx",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("UNAUTHORIZED")) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
