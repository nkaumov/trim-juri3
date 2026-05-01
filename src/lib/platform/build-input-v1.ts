import { splitTextIntoBlocks, type ExtractedDocumentText } from "@/lib/document-text";
import {
  createPlatformInputBase,
  type CounterpartyInputMode,
  type PlatformDocumentV1,
  type PlatformInputV1,
  type PlatformTaskV1,
} from "@/lib/platform/contract-input-v1";

function wrapText(text: ExtractedDocumentText): PlatformDocumentV1["text"] {
  return { ...text, extractor: "jurist3.extract.v1" };
}

export function buildCounterpartyWorkInputV1(args: {
  tenantId: string;
  agentId: string;
  contractId: string;
  clientId?: string;
  inputMode?: CounterpartyInputMode;
  userMessage?: string;
  template: {
    docId?: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
    text?: ExtractedDocumentText;
    meta?: Record<string, unknown>;
    rulesText?: string;
  };
  protocol?: {
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
    text?: ExtractedDocumentText;
    meta?: Record<string, unknown>;
  };
  counterparty: {
    docId?: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
    text?: ExtractedDocumentText;
    meta?: Record<string, unknown>;
  };
  tasks?: PlatformTaskV1[];
}): PlatformInputV1 {
  const base = createPlatformInputBase({
    tenantId: args.tenantId,
    agentId: args.agentId,
    workflow: "counterparty_work",
    entity: { contractId: args.contractId, clientId: args.clientId },
    interaction: { inputMode: args.inputMode, userMessage: args.userMessage || "" },
  });

  const documents: PlatformDocumentV1[] = [];

  documents.push({
    role: "template",
    docId: args.template.docId,
    fileName: args.template.fileName,
    mimeType: args.template.mimeType,
    fileSize: args.template.fileSize,
    text: args.template.text ? wrapText(args.template.text) : undefined,
    meta: args.template.meta,
  });

  documents.push({
    role: "template_rules",
    text:
      typeof args.template.rulesText === "string"
        ? wrapText({
            plain: args.template.rulesText,
            blocks: splitTextIntoBlocks(args.template.rulesText),
          })
        : undefined,
  });

  documents.push({
    role: "counterparty_input",
    docId: args.counterparty.docId,
    fileName: args.counterparty.fileName,
    mimeType: args.counterparty.mimeType,
    fileSize: args.counterparty.fileSize,
    text: args.counterparty.text ? wrapText(args.counterparty.text) : undefined,
    meta: args.counterparty.meta,
  });

  if (args.protocol?.text || args.protocol?.meta) {
    documents.push({
      role: "protocol",
      fileName: args.protocol.fileName,
      mimeType: args.protocol.mimeType,
      fileSize: args.protocol.fileSize,
      text: args.protocol.text ? wrapText(args.protocol.text) : undefined,
      meta: args.protocol.meta,
    });
  }

  return {
    ...base,
    documents,
    tasks:
      Array.isArray(args.tasks) && args.tasks.length > 0
        ? args.tasks
        : [{ type: "protocol_draft" }],
  };
}

export function buildRiskAnalysisInputV1(args: {
  tenantId: string;
  agentId: string;
  analysisCaseId: string;
  userMessage?: string;
  document: {
    docId?: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
    text?: ExtractedDocumentText;
    meta?: Record<string, unknown>;
  };
  tasks?: PlatformTaskV1[];
}): PlatformInputV1 {
  const base = createPlatformInputBase({
    tenantId: args.tenantId,
    agentId: args.agentId,
    workflow: "risk_analysis",
    entity: { analysisCaseId: args.analysisCaseId },
    interaction: { userMessage: args.userMessage || "" },
  });

  const documents: PlatformDocumentV1[] = [
    {
      role: "counterparty_input",
      docId: args.document.docId,
      fileName: args.document.fileName,
      mimeType: args.document.mimeType,
      fileSize: args.document.fileSize,
      text: args.document.text ? wrapText(args.document.text) : undefined,
      meta: args.document.meta,
    },
  ];

  return {
    ...base,
    documents,
    tasks:
      Array.isArray(args.tasks) && args.tasks.length > 0 ? args.tasks : [{ type: "risk_review" }],
  };
}
