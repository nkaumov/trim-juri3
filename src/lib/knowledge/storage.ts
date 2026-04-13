import type { KnowledgeDocument, KnowledgeScope } from "@/lib/knowledge/types";

const storagePrefix = "jurist3.knowledge.documents.v1";

function storageKey(scope: KnowledgeScope): string {
  return `${storagePrefix}:${scope.tenantId}:${scope.agentId}`;
}

export function loadKnowledgeDocuments(scope: KnowledgeScope): KnowledgeDocument[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(storageKey(scope));
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as KnowledgeDocument[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    window.localStorage.removeItem(storageKey(scope));
    return [];
  }
}

export function saveKnowledgeDocuments(scope: KnowledgeScope, docs: KnowledgeDocument[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey(scope), JSON.stringify(docs));
}
