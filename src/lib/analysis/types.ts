import type { ProtocolRow } from "@/lib/contracts/types";

export type RiskSeverity = "high" | "medium" | "low";

export type RiskComment = {
  id: string;
  severity: RiskSeverity;
  title: string;
  details: string;
  basis?: string;
};

export type RiskAnalysisCase = {
  id: string;
  tenantId: string;
  agentId: string;
  title: string;
  sourceFileName: string;
  sourceFileUrl: string;
  sourceFileSize: number;
  sourceMimeType: string;
  extractedText: string;
  createdAt: string;
  status: "draft" | "ready";
  aiSummary?: string;
  aiComments?: RiskComment[];
  protocolRows?: ProtocolRow[];
};

