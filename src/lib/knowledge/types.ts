export type KnowledgeSection = "templates";

export type TemplateRoleMeta = {
  ourRole?: string;
  counterpartyRole?: string;
  confidence?: "low" | "medium" | "high";
  notes?: string;
};

export type KnowledgeDocument = {
  id: string;
  tenantId: string;
  agentId: string;
  section: KnowledgeSection;
  fileName: string;
  originalFileName?: string;
  sourceType?: string;
  tags?: string[];
  rules?: string;
  fileUrl?: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
  templateMeta?: TemplateRoleMeta;
};

export type KnowledgeScope = {
  tenantId: string;
  agentId: string;
};
