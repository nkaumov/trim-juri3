export type ContractIterationAttachment = {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
};

export type AiReviewItem = {
  id: string;
  section: string;
  severity: "critical" | "moderate" | "minor";
  was: string;
  now: string;
  aiComment: string;
};

export type AiAnalysisResult = {
  summary: string;
  recommendation: string;
  generatedAt: string;
  model?: string;
  items: AiReviewItem[];
};

export type ContractIteration = {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  kind?: "created" | "client-request" | "company-response" | "final";
  clientAcknowledged?: boolean;
  clientDecision?: "agreed" | "changes";
  nextAction?: "update-contract" | "prepare-disagreement-protocol";
  requestText?: string;
  attachments?: ContractIterationAttachment[];
  aiAnalysis?: AiAnalysisResult;
  responseDraft?: Record<string, string>;
};

export type ProtocolInputMode =
  | "client-freeform"
  | "client-points"
  | "client-protocol"
  | "edited-template"
  | "protocol-sync";

export type ProtocolRow = {
  clause: string;
  clientText: string;
  ourText?: string;
  agreedText?: string;
};

export type ProtocolComment = {
  id: string;
  clause: string;
  was: string;
  now: string;
  severity: "critical" | "moderate" | "minor";
  comment: string;
  guidance?: string;
};

export type ProtocolRequestLog = {
  id: string;
  mode: ProtocolInputMode;
  text: string;
  fileName?: string;
  fileType?: string;
  createdAt: string;
  summary?: string;
};

export type ContractDraft = {
  id: string;
  clientId: string;
  templateDocId: string;
  templateName: string;
  templateFileUrl?: string;
  protocolFileUrl?: string;
  protocolFileName?: string;
  protocolUpdatedAt?: string;
  protocolRows?: ProtocolRow[];
  protocolComments?: ProtocolComment[];
  protocolSummary?: string;
  protocolRecommendation?: string;
  protocolRequests?: ProtocolRequestLog[];
  createdAt: string;
  status: "draft" | "archived";
  iterations: ContractIteration[];
};