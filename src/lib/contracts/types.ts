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

export type ContractDraft = {
  id: string;
  clientId: string;
  templateDocId: string;
  templateName: string;
  templateFileUrl?: string;
  createdAt: string;
  status: "draft" | "archived";
  iterations: ContractIteration[];
};
