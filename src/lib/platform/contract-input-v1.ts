import crypto from "node:crypto";
import type { ExtractedDocumentText } from "@/lib/document-text";

export type PlatformInputSchema = "jurist3.platform.input.v1";
export type PlatformWorkflow = "counterparty_work" | "risk_analysis";

export type PlatformDocumentRole =
  | "template"
  | "template_rules"
  | "counterparty_input"
  | "protocol"
  | "final"
  | "other";

export type PlatformDocumentText = ExtractedDocumentText & {
  extractor: "jurist3.extract.v1";
};

export type PlatformDocumentV1 = {
  role: PlatformDocumentRole;
  docId?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  text?: PlatformDocumentText;
  meta?: Record<string, unknown>;
};

export type CounterpartyInputMode =
  | "client-freeform"
  | "client-points"
  | "client-protocol"
  | "edited-template"
  | "commented-template"
  | "protocol-sync";

export type PlatformTaskV1 =
  | { type: "risk_review"; options?: Record<string, unknown> }
  | { type: "protocol_draft"; options?: Record<string, unknown> }
  | { type: "diff_review"; options?: Record<string, unknown> };

export type PlatformInputV1 = {
  schema: PlatformInputSchema;
  requestId: string;
  sentAt: string;
  tenantId: string;
  agentId: string;
  workflow: PlatformWorkflow;
  entity: {
    contractId?: string;
    clientId?: string;
    analysisCaseId?: string;
  };
  interaction: {
    inputMode?: CounterpartyInputMode;
    userMessage?: string;
  };
  documents: PlatformDocumentV1[];
  tasks: PlatformTaskV1[];
};

export function createPlatformInputBase(args: {
  tenantId: string;
  agentId: string;
  workflow: PlatformWorkflow;
  entity?: PlatformInputV1["entity"];
  interaction?: PlatformInputV1["interaction"];
}): Omit<PlatformInputV1, "documents" | "tasks"> {
  return {
    schema: "jurist3.platform.input.v1",
    requestId: crypto.randomUUID(),
    sentAt: new Date().toISOString(),
    tenantId: args.tenantId,
    agentId: args.agentId,
    workflow: args.workflow,
    entity: args.entity ?? {},
    interaction: args.interaction ?? {},
  };
}

