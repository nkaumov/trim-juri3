export type KnowledgeSection = "templates" | "rules" | "fz";

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
