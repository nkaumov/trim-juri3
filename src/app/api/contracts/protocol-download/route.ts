import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { getStore } from "@/lib/storage-server";
import PizZip from "pizzip";

export const runtime = "nodejs";

type ProtocolRow = {
  clause: string;
  clientText: string;
  ourText?: string;
  agreedText?: string;
};

type ContractStoreItem = {
  id: string;
  protocolRows?: ProtocolRow[];
};

function isContractStoreItem(value: unknown): value is ContractStoreItem {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { id?: unknown }).id === "string";
}

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

function buildTable(rows: ProtocolRow[]) {
  const header = [
    "\u2116 \u043f/\u043f",
    "\u041f\u0443\u043d\u043a\u0442 \u0434\u043e\u0433\u043e\u0432\u043e\u0440\u0430",
    "\u0420\u0435\u0434\u0430\u043a\u0446\u0438\u044f ____________",
    "\u0420\u0435\u0434\u0430\u043a\u0446\u0438\u044f ____________",
    "\u0421\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u043d\u0430\u044f \u0440\u0435\u0434\u0430\u043a\u0446\u0438\u044f",
  ];
  const headerRow = `<w:tr>${header
    .map(
      (cell) =>
        `<w:tc><w:tcPr><w:tcW w:w=\"2200\" w:type=\"dxa\"/></w:tcPr><w:p><w:r>${formatCell(
          cell,
        )}</w:r></w:p></w:tc>`,
    )
    .join("")}</w:tr>`;

  const bodyRows = rows
    .map(
      (row, index) =>
        `<w:tr>` +
        `<w:tc><w:tcPr><w:tcW w:w=\"1000\" w:type=\"dxa\"/></w:tcPr><w:p><w:r>${formatCell(
          String(index + 1),
        )}</w:r></w:p></w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w=\"2200\" w:type=\"dxa\"/></w:tcPr><w:p><w:r>${formatCell(
          row.clause || "",
        )}</w:r></w:p></w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w=\"3200\" w:type=\"dxa\"/></w:tcPr><w:p><w:r>${formatCell(
          row.clientText || "",
        )}</w:r></w:p></w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w=\"3200\" w:type=\"dxa\"/></w:tcPr><w:p><w:r>${formatCell(
          row.ourText || "",
        )}</w:r></w:p></w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w=\"3200\" w:type=\"dxa\"/></w:tcPr><w:p><w:r>${formatCell(
          row.agreedText || "",
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
        <w:gridCol w:w=\"1000\"/>
        <w:gridCol w:w=\"2200\"/>
        <w:gridCol w:w=\"3200\"/>
        <w:gridCol w:w=\"3200\"/>
        <w:gridCol w:w=\"3200\"/>
      </w:tblGrid>
      ${headerRow}
      ${bodyRows}
    </w:tbl>`;
}

function buildSignatureBlock(): string {
  return `
    <w:p><w:r><w:t> </w:t></w:r></w:p>
    <w:p><w:r><w:t>\u0421\u0442\u043e\u0440\u043e\u043d\u0430 1: ____________________ /____________________/</w:t></w:r></w:p>
    <w:p><w:r><w:t>\u041d\u0430\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u0435: ____________________________________________</w:t></w:r></w:p>
    <w:p><w:r><w:t> </w:t></w:r></w:p>
    <w:p><w:r><w:t>\u0421\u0442\u043e\u0440\u043e\u043d\u0430 2: ____________________ /____________________/</w:t></w:r></w:p>
    <w:p><w:r><w:t>\u041d\u0430\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u0435: ____________________________________________</w:t></w:r></w:p>
  `;
}

function buildDocx(rows: ProtocolRow[]) {
  const tableXml = buildTable(rows);
  const signatureXml = buildSignatureBlock();
  const documentXml = `<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>
<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">
  <w:body>
    <w:p><w:r><w:t>\u041f\u0420\u041e\u0422\u041e\u041a\u041e\u041b \u0420\u0410\u0417\u041d\u041e\u0413\u041b\u0410\u0421\u0418\u0419</w:t></w:r></w:p>
    ${tableXml}
    ${signatureXml}
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

    const contracts = await getStore<unknown[]>("contracts_store", scope);
    const list = Array.isArray(contracts) ? contracts.filter(isContractStoreItem) : [];
    const contract = list.find((item) => item.id === contractId);
    if (!contract) {
      return NextResponse.json({ error: "contract not found" }, { status: 404 });
    }
    const rows = Array.isArray(contract.protocolRows) ? contract.protocolRows : [];
    const buffer = buildDocx(rows);
    const body = new Uint8Array(buffer);

    return new NextResponse(body, {
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
