"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ContractDraft, ProtocolRow } from "@/lib/contracts/types";
import type { KnowledgeDocument, KnowledgeScope } from "@/lib/knowledge/types";
import { usePublicConfig } from "@/lib/usePublicConfig";
import type { RiskAnalysisCase, RiskComment, RiskSeverity } from "@/lib/analysis/types";

type Section = "dashboard" | "contracts" | "analysis" | "knowledge";

type Client = {
  id: string;
  companyName: string;
  notes: string;
  createdAt: string;
};

const navItems: Array<{ id: Section; label: string }> = [
  { id: "dashboard", label: "Дашборд" },
  { id: "contracts", label: "Работа с контрагентами" },
  { id: "analysis", label: "Анализ рисков" },
  { id: "knowledge", label: "База знаний" },
];

function formatDate(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function severityLabel(value: RiskSeverity): string {
  if (value === "high") return "высокий риск";
  if (value === "medium") return "средний риск";
  return "низкий риск";
}

function severityClass(value: RiskSeverity): string {
  if (value === "high") return "severity-critical";
  if (value === "medium") return "severity-moderate";
  return "severity-minor";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeRiskSeverity(value: unknown): RiskSeverity {
  const raw = asString(value).trim().toLowerCase();
  if (raw === "high" || raw === "critical") return "high";
  if (raw === "medium" || raw === "moderate") return "medium";
  if (raw === "low" || raw === "minor") return "low";
  return "medium";
}

type PlatformOutputProtocolRow = {
  clause?: unknown;
  client_text?: unknown;
  clientText?: unknown;
  our_text?: unknown;
  ourText?: unknown;
};

function mapPlatformOutputToProtocolRows(output: Record<string, unknown>): ProtocolRow[] {
  const rows = asArray(output["protocol_rows"] ?? output["protocolRows"]);
  const mapped: ProtocolRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as PlatformOutputProtocolRow;
    const clause = asString(row.clause).trim() || "\u2014";
    const clientText = asString(row.client_text ?? row.clientText).trim();
    const ourText = asString(row.our_text ?? row.ourText).trim();
    if (!clientText && !ourText) continue;
    mapped.push({ clause, clientText, ourText });
  }
  return mapped;
}

function mapPlatformOutputToRiskComments(output: Record<string, unknown>): RiskComment[] {
  const rawItems = asArray(
    output["items"] ??
      output["risk_items"] ??
      output["riskItems"] ??
      output["risks"] ??
      output["comments"] ??
      [],
  );

  const mapped: RiskComment[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const item = asRecord(raw);
    const title =
      asString(item["title"]).trim() ||
      asString(item["clause"]).trim() ||
      asString(item["id"]).trim() ||
      "Риск";
    const details =
      asString(item["details"]).trim() ||
      asString(item["comment"] ?? item["aiComment"] ?? item["text"]).trim() ||
      "Комментарий не указан.";
    const basis = asString(item["basis"] ?? item["law"] ?? item["grounds"] ?? item["guidance"]).trim();

    mapped.push({
      id: asString(item["id"]).trim() || crypto.randomUUID(),
      severity: normalizeRiskSeverity(item["severity"]),
      title,
      details,
      basis: basis || undefined,
    });
  }

  return mapped;
}

export function AppShell() {
  const { config: publicConfig } = usePublicConfig();
  const tenantId = publicConfig?.platformTenantId ?? "local-tenant";
  const agentId = publicConfig?.platformAgentId ?? "jurist3-agent";
  const knowledgeScope: KnowledgeScope = { tenantId, agentId };

  const [hydrated, setHydrated] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("dashboard");
  const [clients, setClients] = useState<Client[]>([]);
  const [contracts, setContracts] = useState<ContractDraft[]>([]);
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDocument[]>([]);
  const [analysisCases, setAnalysisCases] = useState<RiskAnalysisCase[]>([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [contractsLoaded, setContractsLoaded] = useState(false);
  const [knowledgeLoaded, setKnowledgeLoaded] = useState(false);
  const [analysisLoaded, setAnalysisLoaded] = useState(false);

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [contractsViewMode, setContractsViewMode] = useState<"active" | "archive">("active");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isComposeModalOpen, setIsComposeModalOpen] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [createClientBusy, setCreateClientBusy] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [composeError, setComposeError] = useState<string | null>(null);
  const [isTemplateDropdownOpen, setIsTemplateDropdownOpen] = useState(false);
  const [templateUploadError, setTemplateUploadError] = useState<string | null>(null);
  const [templateUploadBusy, setTemplateUploadBusy] = useState(false);
  const [templateUploadFile, setTemplateUploadFile] = useState<File | null>(null);
  const [templateUploadFileKey, setTemplateUploadFileKey] = useState(0);
  const [templateUploadTitle, setTemplateUploadTitle] = useState("");
  const [templateUploadSourceType, setTemplateUploadSourceType] = useState("template");
  const [templateUploadTags, setTemplateUploadTags] = useState("");
  const [templateUploadRules, setTemplateUploadRules] = useState("");
  const [isTemplateUploadModalOpen, setIsTemplateUploadModalOpen] = useState(false);
  const [templateDetailsId, setTemplateDetailsId] = useState<string | null>(null);
  const [templateDetailsEditing, setTemplateDetailsEditing] = useState(false);
  const [templateDetailsTitle, setTemplateDetailsTitle] = useState("");
  const [templateDetailsSourceType, setTemplateDetailsSourceType] = useState("template");
  const [templateDetailsTags, setTemplateDetailsTags] = useState("");
  const [templateDetailsRules, setTemplateDetailsRules] = useState("");
  const [templateDetailsError, setTemplateDetailsError] = useState<string | null>(null);
  const [clientTemplateMeta, setClientTemplateMeta] = useState<{
    docId: string;
    fileUrl: string;
    fileName: string;
    fileSize: number;
  } | null>(null);
  const [clientTemplateUploading, setClientTemplateUploading] = useState(false);
  const [clientTemplateError, setClientTemplateError] = useState<string | null>(null);

  const [analysisActiveId, setAnalysisActiveId] = useState<string | null>(null);
  const [analysisUploadBusy, setAnalysisUploadBusy] = useState(false);
  const [analysisUploadError, setAnalysisUploadError] = useState<string | null>(null);
  const [analysisUploadFile, setAnalysisUploadFile] = useState<File | null>(null);
  const [analysisUploadFileKey, setAnalysisUploadFileKey] = useState(0);
  const [analysisTitle, setAnalysisTitle] = useState("");
  const [isAnalysisUploadModalOpen, setIsAnalysisUploadModalOpen] = useState(false);
  const [analysisActiveTab, setAnalysisActiveTab] = useState<"ai" | "protocol" | "text">("ai");
  const [analysisRunBusy, setAnalysisRunBusy] = useState(false);
  const [analysisRunError, setAnalysisRunError] = useState<string | null>(null);
  const [analysisProtocolDraft, setAnalysisProtocolDraft] = useState<
    Array<{ clause: string; clientText: string; ourText: string }>
  >([]);

  const templateDropdownRef = useRef<HTMLDivElement | null>(null);
  const clientTemplateInputRef = useRef<HTMLInputElement | null>(null);

  const templateDetailsDoc = useMemo(() => {
    if (!templateDetailsId) return null;
    return knowledgeDocs.find((doc) => doc.id === templateDetailsId) ?? null;
  }, [knowledgeDocs, templateDetailsId]);


  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!analysisActiveId) {
      setAnalysisProtocolDraft([]);
      return;
    }
    const active = analysisCases.find((item) => item.id === analysisActiveId) ?? null;
    if (!active) {
      setAnalysisProtocolDraft([]);
      return;
    }
    if (!Array.isArray(active.protocolRows) || active.protocolRows.length === 0) {
      setAnalysisProtocolDraft([]);
      return;
    }
    setAnalysisProtocolDraft(
      active.protocolRows.map((row) => ({
        clause: String(row.clause || ""),
        clientText: String(row.clientText || ""),
        ourText: String(row.ourText || ""),
      })),
    );
  }, [analysisActiveId, analysisCases]);

  useEffect(() => {
    if (!templateDetailsDoc) {
      setTemplateDetailsEditing(false);
      setTemplateDetailsTitle("");
      setTemplateDetailsSourceType("template");
      setTemplateDetailsTags("");
      setTemplateDetailsRules("");
      setTemplateDetailsError(null);
      return;
    }

    setTemplateDetailsEditing(false);
    setTemplateDetailsTitle(templateDetailsDoc.fileName || "");
    setTemplateDetailsSourceType(templateDetailsDoc.sourceType || "template");
    setTemplateDetailsTags(
      Array.isArray(templateDetailsDoc.tags) ? templateDetailsDoc.tags.join(", ") : "",
    );
    setTemplateDetailsRules(templateDetailsDoc.rules || "");
    setTemplateDetailsError(null);
  }, [templateDetailsDoc]);

  useEffect(() => {
    if (!hydrated) return;
    const headers = {
      "x-tenant-id": knowledgeScope.tenantId,
      "x-agent-id": knowledgeScope.agentId,
    };
    void (async () => {
      const meRes = await fetch("/api/auth/me", { cache: "no-store" }).catch(() => null);
      if (!meRes || meRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      const [clientsRes, contractsRes, knowledgeRes, analysisRes] = await Promise.all([
        fetch("/api/storage/clients", { headers }),
        fetch("/api/storage/contracts", { headers }),
        fetch("/api/storage/knowledge", { headers }),
        fetch("/api/storage/analysis", { headers }),
      ]);
      if ([clientsRes, contractsRes, knowledgeRes, analysisRes].some((res) => res.status === 401)) {
        window.location.href = "/login";
        return;
      }
      const clientsPayload = (await clientsRes.json().catch(() => null)) as { items?: Client[] } | null;
      const contractsPayload = (await contractsRes.json().catch(() => null)) as { items?: ContractDraft[] } | null;
      const knowledgePayload = (await knowledgeRes.json().catch(() => null)) as { items?: KnowledgeDocument[] } | null;
      const analysisPayload = (await analysisRes.json().catch(() => null)) as { items?: RiskAnalysisCase[] } | null;

      if (Array.isArray(clientsPayload?.items)) setClients(clientsPayload.items);
      if (Array.isArray(contractsPayload?.items)) setContracts(contractsPayload.items);
      if (Array.isArray(knowledgePayload?.items)) setKnowledgeDocs(knowledgePayload.items);
      if (Array.isArray(analysisPayload?.items)) setAnalysisCases(analysisPayload.items);
      setClientsLoaded(true);
      setContractsLoaded(true);
      setKnowledgeLoaded(true);
      setAnalysisLoaded(true);
    })();
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated || !clientsLoaded) return;
    const headers = {
      "Content-Type": "application/json",
      "x-tenant-id": knowledgeScope.tenantId,
      "x-agent-id": knowledgeScope.agentId,
    };

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void fetch("/api/storage/clients", {
        method: "POST",
        headers,
        body: JSON.stringify({ items: clients }),
        signal: controller.signal,
      }).catch(() => null);
    }, 400);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [clients, hydrated, clientsLoaded]);

  useEffect(() => {
    if (!hydrated || !contractsLoaded) return;
    const headers = {
      "Content-Type": "application/json",
      "x-tenant-id": knowledgeScope.tenantId,
      "x-agent-id": knowledgeScope.agentId,
    };

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void fetch("/api/storage/contracts", {
        method: "POST",
        headers,
        body: JSON.stringify({ items: contracts }),
        signal: controller.signal,
      }).catch(() => null);
    }, 400);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [contracts, hydrated, contractsLoaded]);

  useEffect(() => {
    if (!hydrated || !knowledgeLoaded) return;
    const headers = {
      "Content-Type": "application/json",
      "x-tenant-id": knowledgeScope.tenantId,
      "x-agent-id": knowledgeScope.agentId,
    };

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void fetch("/api/storage/knowledge", {
        method: "POST",
        headers,
        body: JSON.stringify({ items: knowledgeDocs }),
        signal: controller.signal,
      }).catch(() => null);
    }, 400);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [knowledgeDocs, hydrated, knowledgeLoaded]);

  useEffect(() => {
    if (!hydrated || !analysisLoaded) return;
    const headers = {
      "Content-Type": "application/json",
      "x-tenant-id": knowledgeScope.tenantId,
      "x-agent-id": knowledgeScope.agentId,
    };

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void fetch("/api/storage/analysis", {
        method: "POST",
        headers,
        body: JSON.stringify({ items: analysisCases }),
        signal: controller.signal,
      }).catch(() => null);
    }, 400);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [analysisCases, hydrated, analysisLoaded]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!templateDropdownRef.current) {
        return;
      }

      if (!templateDropdownRef.current.contains(event.target as Node)) {
        setIsTemplateDropdownOpen(false);
      }
    }

    if (isTemplateDropdownOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isTemplateDropdownOpen]);

  const selectedClient = useMemo(
    () => clients.find((item) => item.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );

  const availableTemplates = useMemo(
    () => knowledgeDocs.filter((doc) => doc.section === "templates" && Boolean(doc.fileUrl)),
    [knowledgeDocs],
  );

  const selectedClientContracts = useMemo(
    () => contracts.filter((item) => item.clientId === selectedClientId),
    [contracts, selectedClientId],
  );
  const selectedClientActiveContracts = useMemo(
    () => selectedClientContracts.filter((item) => item.status === "draft"),
    [selectedClientContracts],
  );
  const selectedClientArchivedContracts = useMemo(
    () => selectedClientContracts.filter((item) => item.status !== "draft"),
    [selectedClientContracts],
  );
  const selectedTemplate = useMemo(
    () => availableTemplates.find((item) => item.id === selectedTemplateId) ?? null,
    [availableTemplates, selectedTemplateId],
  );

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (createClientBusy) return;

    const normalizedName = companyName.trim();
    if (!normalizedName) {
      setFormError("Введите название компании.");
      return;
    }

    const newClient: Client = {
      id: crypto.randomUUID(),
      companyName: normalizedName,
      notes: notes.trim(),
      createdAt: new Date().toISOString(),
    };

    const nextClients = [newClient, ...clients];
    const headers = {
      "Content-Type": "application/json",
      "x-tenant-id": knowledgeScope.tenantId,
      "x-agent-id": knowledgeScope.agentId,
    };

    setCreateClientBusy(true);
    setFormError(null);
    try {
      const response = await fetch("/api/storage/clients", {
        method: "POST",
        headers,
        body: JSON.stringify({ items: nextClients }),
      });
      if (!response.ok) {
        throw new Error("save failed");
      }

      setClients(nextClients);
      setCompanyName("");
      setNotes("");
      setIsCreateModalOpen(false);
    } catch {
      setFormError("Не удалось сохранить организацию. Попробуйте еще раз.");
    } finally {
      setCreateClientBusy(false);
    }
  }

  function openClient(clientId: string) {
    setSelectedClientId(clientId);
    setContractsViewMode("active");
  }

  function openCreateModal() {
    setIsCreateModalOpen(true);
    setFormError(null);
  }

  function closeCreateModal() {
    setIsCreateModalOpen(false);
    setCompanyName("");
    setNotes("");
    setFormError(null);
    setCreateClientBusy(false);
  }

  function openComposeModal() {
    setIsComposeModalOpen(true);
    setComposeError(null);
    setSelectedTemplateId("");
    setClientTemplateMeta(null);
    setClientTemplateError(null);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function closeComposeModal() {
    setIsComposeModalOpen(false);
    setComposeError(null);
    setSelectedTemplateId("");
    setIsTemplateDropdownOpen(false);
    setClientTemplateMeta(null);
    setClientTemplateError(null);
  }

  async function handleClientTemplateUpload(file: File | null) {
    if (!file) {
      return;
    }
    setClientTemplateUploading(true);
    setClientTemplateError(null);
    setComposeError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/contracts/template-upload", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error("upload failed");
      }
      const payload = (await response.json()) as {
        docId?: string;
        fileUrl?: string;
        fileName?: string;
        fileSize?: number;
      };
      if (!payload?.docId || !payload.fileUrl || !payload.fileName) {
        throw new Error("invalid response");
      }
      setSelectedTemplateId("");
      setClientTemplateMeta({
        docId: payload.docId,
        fileUrl: payload.fileUrl,
        fileName: payload.fileName,
        fileSize: payload.fileSize ?? file.size,
      });
    } catch {
      setClientTemplateError("Не удалось загрузить договор клиента. Попробуйте еще раз.");
    } finally {
      setClientTemplateUploading(false);
    }
  }

  async function createContractDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedClientId) {
      return;
    }

    const hasClientTemplate = Boolean(clientTemplateMeta);
    if (!hasClientTemplate && !selectedTemplateId) {
      setComposeError("Выберите шаблон договора.");
      return;
    }

    const template = availableTemplates.find((item) => item.id === selectedTemplateId) ?? null;
    if (!hasClientTemplate) {
      if (!template) {
        setComposeError("Шаблон не найден. Обновите список шаблонов.");
        return;
      }
      if (!template.fileUrl) {
        setComposeError("Для шаблона не найден файл. Загрузите шаблон заново.");
        return;
      }

      try {
        const checkResponse = await fetch(template.fileUrl, {
          method: "HEAD",
          cache: "no-store",
        });
        if (!checkResponse.ok) {
          setComposeError("Файл шаблона недоступен. Перезагрузите его в Базе знаний.");
          return;
        }
      } catch {
        setComposeError("Не удалось проверить файл шаблона. Попробуйте еще раз.");
        return;
      }
    }

    const newDraft: ContractDraft = {
      id: crypto.randomUUID(),
      clientId: selectedClientId,
      templateDocId: hasClientTemplate ? clientTemplateMeta!.docId : template!.id,
      templateName: hasClientTemplate ? clientTemplateMeta!.fileName : template!.fileName,
      templateFileUrl: hasClientTemplate ? clientTemplateMeta!.fileUrl : template!.fileUrl,
      createdAt: new Date().toISOString(),
      status: "draft",
      iterations: [
        {
          id: crypto.randomUUID(),
          title: "Договор создан",
          content:
            `Шаблон договора: ${hasClientTemplate ? clientTemplateMeta!.fileName : template!.fileName}\n\n` +
            "Исходная версия создана на основе выбранного шаблона.\n" +
            "Следующие итерации фиксируют изменения в процессе согласования.",
          updatedAt: new Date().toISOString(),
          kind: "created",
        },
      ],
    };

    setContracts((prev) => [newDraft, ...prev]);
    closeComposeModal();
  }

  async function uploadTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const file = templateUploadFile;
    const normalizedTitle = templateUploadTitle.trim();
    const normalizedSourceType = templateUploadSourceType.trim() || "template";
    const tags = templateUploadTags
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const normalizedRules = templateUploadRules.trim();

    if (!file) {
      setTemplateUploadError("Выберите файл шаблона.");
      return;
    }

    if (!normalizedTitle) {
      setTemplateUploadError("Укажите название шаблона.");
      return;
    }

    setTemplateUploadBusy(true);
    setTemplateUploadError(null);

    const formData = new FormData();
    formData.append("file", file);

    let fileUrl: string | undefined;
    try {
      const response = await fetch("/api/knowledge/upload", {
        method: "POST",
        body: formData,
      });
      if (response.ok) {
        const payload = (await response.json()) as { fileUrl?: string };
        fileUrl = payload.fileUrl;
      }
    } catch {
      fileUrl = undefined;
    }

    if (!fileUrl) {
      setTemplateUploadError("Не удалось загрузить файл. Попробуйте еще раз.");
      setTemplateUploadBusy(false);
      return;
    }

    const urlDocId = fileUrl.split("/").filter(Boolean).slice(-1)[0];
    const doc: KnowledgeDocument = {
      id: urlDocId || crypto.randomUUID(),
      tenantId: knowledgeScope.tenantId,
      agentId: knowledgeScope.agentId,
      section: "templates",
      fileName: normalizedTitle,
      originalFileName: file.name,
      sourceType: normalizedSourceType,
      tags,
      rules: normalizedRules ? normalizedRules : undefined,
      fileUrl,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
      uploadedAt: new Date().toISOString(),
    };

    setKnowledgeDocs((prev) => [doc, ...prev]);
    setTemplateUploadFile(null);
    setTemplateUploadTitle("");
    setTemplateUploadSourceType("template");
    setTemplateUploadTags("");
    setTemplateUploadRules("");
    setTemplateUploadFileKey((value) => value + 1);
    setTemplateUploadBusy(false);
    setIsTemplateUploadModalOpen(false);
  }

  function removeKnowledgeDoc(id: string) {
    setKnowledgeDocs((prev) => prev.filter((doc) => doc.id !== id));
  }

  function closeTemplateDetails() {
    setTemplateDetailsId(null);
  }

  function startTemplateDetailsEdit() {
    if (!templateDetailsDoc) return;
    setTemplateDetailsEditing(true);
    setTemplateDetailsError(null);
  }

  function cancelTemplateDetailsEdit() {
    if (!templateDetailsDoc) {
      setTemplateDetailsEditing(false);
      return;
    }
    setTemplateDetailsEditing(false);
    setTemplateDetailsTitle(templateDetailsDoc.fileName || "");
    setTemplateDetailsSourceType(templateDetailsDoc.sourceType || "template");
    setTemplateDetailsTags(
      Array.isArray(templateDetailsDoc.tags) ? templateDetailsDoc.tags.join(", ") : "",
    );
    setTemplateDetailsRules(templateDetailsDoc.rules || "");
    setTemplateDetailsError(null);
  }

  function saveTemplateDetails() {
    if (!templateDetailsDoc) return;

    const title = templateDetailsTitle.trim();
    if (!title) {
      setTemplateDetailsError("Укажите название шаблона.");
      return;
    }

    const sourceType = templateDetailsSourceType.trim() || "template";
    const tags = templateDetailsTags
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const rules = templateDetailsRules.trim();

    setKnowledgeDocs((prev) =>
      prev.map((doc) =>
        doc.id === templateDetailsDoc.id
          ? {
              ...doc,
              fileName: title,
              sourceType,
              tags,
              rules: rules ? rules : undefined,
            }
          : doc,
      ),
    );

    setTemplateDetailsEditing(false);
    setTemplateDetailsError(null);
  }

  function openAnalysisCase(caseId: string) {
    setAnalysisActiveId(caseId);
    setAnalysisActiveTab("ai");
    setAnalysisUploadError(null);
    setAnalysisRunError(null);
  }

  async function persistAnalysisCases(items: RiskAnalysisCase[]) {
    await fetch("/api/storage/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
  }

  async function runRiskAnalysis(caseId: string) {
    if (!caseId) return;
    setAnalysisRunBusy(true);
    setAnalysisRunError(null);
    try {
      const response = await fetch("/api/platform/debug-risk-input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisCaseId: caseId }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { platformOutput?: unknown; platformError?: unknown; error?: unknown }
        | null;

      if (!response.ok) {
        const msg =
          (payload?.platformError ? String(payload.platformError) : "") ||
          (payload?.error ? String(payload.error) : "") ||
          "Не удалось получить ответ от платформы.";
        setAnalysisRunError(msg);
        setAnalysisRunBusy(false);
        return;
      }

      if (!payload?.platformOutput || typeof payload.platformOutput !== "object") {
        setAnalysisRunError("Ответ платформы не распознан как JSON. Проверьте prompt агента.");
        setAnalysisRunBusy(false);
        return;
      }

      const output = payload.platformOutput as Record<string, unknown>;
      const rows = mapPlatformOutputToProtocolRows(output);
      const comments = mapPlatformOutputToRiskComments(output);
      const summary = asString(output["summary"]).trim();
      const recommendation = asString(output["recommendation"]).trim();

      setAnalysisCases((prev) =>
        prev.map((item) =>
          item.id === caseId
            ? {
                ...item,
                status: "ready",
                aiSummary: summary || recommendation || "Ответ получен.",
                aiComments: comments,
                protocolRows: rows,
              }
            : item,
        ),
      );

      setAnalysisActiveId(caseId);
      setAnalysisActiveTab("ai");
    } catch {
      setAnalysisRunError("Не удалось получить ответ от платформы.");
    } finally {
      setAnalysisRunBusy(false);
    }
  }

  function deleteAnalysisCase(caseId: string) {
    setAnalysisCases((prev) => {
      const next = prev.filter((item) => item.id !== caseId);
      if (analysisActiveId === caseId) {
        setAnalysisActiveId(next[0]?.id ?? null);
      }
      return next;
    });
  }

  function clearAnalysisHistory() {
    setAnalysisCases([]);
    setAnalysisActiveId(null);
    setAnalysisProtocolDraft([]);
    setAnalysisRunError(null);
  }

  async function uploadAnalysisDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const file = analysisUploadFile;
    const title = analysisTitle.trim();

    if (!file) {
      setAnalysisUploadError("Выберите документ контрагента.");
      return;
    }

    setAnalysisUploadBusy(true);
    setAnalysisUploadError(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/analysis/upload", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        setAnalysisUploadError("Не удалось загрузить документ. Попробуйте еще раз.");
        setAnalysisUploadBusy(false);
        return;
      }
      const payload = (await response.json()) as {
        ok?: boolean;
        docId?: string;
        fileUrl?: string;
        fileName?: string;
        fileSize?: number;
        mimeType?: string;
        extractedText?: string;
      };
      if (!payload?.docId || !payload?.fileUrl) {
        setAnalysisUploadError("Не удалось загрузить документ. Попробуйте еще раз.");
        setAnalysisUploadBusy(false);
        return;
      }

      const extractedText = String(payload.extractedText || "");

      const newCase: RiskAnalysisCase = {
        id: crypto.randomUUID(),
        tenantId: knowledgeScope.tenantId,
        agentId: knowledgeScope.agentId,
        title: title || payload.fileName || "Анализ договора",
        sourceFileName: payload.fileName || file.name,
        sourceFileUrl: payload.fileUrl,
        sourceFileSize: Number(payload.fileSize || file.size),
        sourceMimeType: payload.mimeType || file.type || "application/octet-stream",
        extractedText,
        createdAt: new Date().toISOString(),
        status: "draft",
      };

      const nextCases = [newCase, ...analysisCases];
      setAnalysisCases(nextCases);
      await persistAnalysisCases(nextCases);
      setAnalysisActiveId(newCase.id);
      setAnalysisActiveTab("ai");
      setAnalysisTitle("");
      setAnalysisUploadFile(null);
      setAnalysisUploadFileKey((value) => value + 1);
      setIsAnalysisUploadModalOpen(false);

      void runRiskAnalysis(newCase.id);
    } catch {
      setAnalysisUploadError("Не удалось загрузить документ. Попробуйте еще раз.");
    } finally {
      setAnalysisUploadBusy(false);
    }
  }

  function saveAnalysisProtocolDraft() {
    if (!analysisActiveId) return;
    setAnalysisCases((prev) =>
      prev.map((item) =>
        item.id === analysisActiveId
          ? {
              ...item,
              protocolRows: analysisProtocolDraft
                .map((row) => ({
                  clause: row.clause.trim(),
                  clientText: row.clientText.trim(),
                  ourText: row.ourText.trim(),
                }))
                .filter((row) => row.clause || row.clientText || row.ourText),
            }
          : item,
      ),
    );
  }

  function archiveContractDraft(draftId: string) {
    setContracts((prev) =>
      prev.map((item) =>
        item.id === draftId
          ? {
              ...item,
              status: "archived",
            }
          : item,
      ),
    );
  }

  function restoreContractDraft(draftId: string) {
    setContracts((prev) =>
      prev.map((item) =>
        item.id === draftId
          ? {
              ...item,
              status: "draft",
            }
          : item,
      ),
    );
  }

  function renderContractsSection() {
    if (selectedClient) {
      return (
        <section className="workspace-stack contracts-client-stack">
          <div className="workspace-header">
            <div className="workspace-header__controls">
              <button
                className="ghost-btn ghost-btn--inline"
                onClick={() => setSelectedClientId(null)}
                type="button"
              >
                ← Назад к клиентам
              </button>
              <button
                className={`ghost-btn ghost-btn--inline ${
                  contractsViewMode === "archive" ? "ghost-btn--active" : ""
                }`}
                onClick={() =>
                  setContractsViewMode((prev) => (prev === "active" ? "archive" : "active"))
                }
                type="button"
              >
                Архив
              </button>
            </div>
            <h1>{selectedClient.companyName}</h1>
            <p>Карточка организации. Здесь создаем открытые дела на основе шаблонов.</p>
            <div className="header-actions">
              <button className="primary" onClick={openComposeModal} type="button">
                Открыть дело
              </button>
            </div>
          </div>

          <article className="card">
            <h3>Заметки по организации</h3>
            <p className="muted-text">
              {selectedClient.notes || "Заметок пока нет. Их можно будет редактировать позже."}
            </p>
          </article>

          {contractsViewMode === "active" ? (
            <article className="card contracts-list-card">
              <h3>Открытые дела</h3>
              {selectedClientActiveContracts.length === 0 ? (
                <p className="muted-text">
                  Открытых дел пока нет. Нажмите &quot;Открыть дело&quot; и выберите шаблон.
                </p>
              ) : (
                <div className="draft-list">
                  {selectedClientActiveContracts.map((draft) => (
                    <div className="draft-card" key={draft.id}>
                      <div className="draft-card__title">{draft.templateName}</div>
                      <div className="draft-card__meta">Создан: {formatDate(draft.createdAt)}</div>
                      <div className="draft-card__meta">Статус: открытое дело</div>
                      <div className="draft-card__actions">
                        <Link className="ghost-btn ghost-btn--inline" href={`/contracts/${draft.id}`}>
                          Перейти в договор
                        </Link>
                        <button
                          className="ghost-btn ghost-btn--inline"
                          onClick={() => archiveContractDraft(draft.id)}
                          type="button"
                        >
                          В архив
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          ) : (
            <article className="card contracts-list-card">
              <h3>Архив договоров</h3>
              {selectedClientArchivedContracts.length === 0 ? (
                <p className="muted-text">Архив пуст.</p>
              ) : (
                <div className="draft-list">
                  {selectedClientArchivedContracts.map((draft) => (
                    <div className="draft-card" key={draft.id}>
                      <div className="draft-card__title">{draft.templateName}</div>
                      <div className="draft-card__meta">Создан: {formatDate(draft.createdAt)}</div>
                      <div className="draft-card__meta">
                        Статус: {draft.status === "finalized" ? "завершен" : "архив"}
                      </div>
                      <div className="draft-card__actions">
                        <Link className="ghost-btn ghost-btn--inline" href={`/contracts/${draft.id}`}>
                          Открыть договор
                        </Link>
                        <button
                          className="ghost-btn ghost-btn--inline"
                          onClick={() => restoreContractDraft(draft.id)}
                          type="button"
                        >
                          Восстановить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          )}

          {isComposeModalOpen ? (
            <div className="modal-root" role="dialog" aria-modal="true" aria-label="Открыть дело">
              <div className="modal-backdrop" onClick={closeComposeModal} />
              <div className="modal-card">
                <h3>Открыть дело</h3>
                <form className="client-form" onSubmit={createContractDraft}>
                  <div className="field">
                    <span>Договор по форме клиента (опционально)</span>
                    <div className="contract-upload">
                      <button
                        className="ghost-btn ghost-btn--inline"
                        type="button"
                        disabled={clientTemplateUploading}
                        onClick={() => clientTemplateInputRef.current?.click()}
                      >
                        Прикрепить договор по форме клиента
                      </button>
                      <input
                        ref={clientTemplateInputRef}
                        className="hidden-file-input"
                        type="file"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0] ?? null;
                          event.currentTarget.value = "";
                          void handleClientTemplateUpload(file);
                        }}
                      />
                    </div>
                  </div>

                  {clientTemplateMeta ? (
                    <div className="template-attachment">
                      <div>
                        <strong>{clientTemplateMeta.fileName}</strong>
                        <span className="muted-text">
                          {formatFileSize(clientTemplateMeta.fileSize)}
                        </span>
                      </div>
                      <button
                        className="ghost-btn ghost-btn--inline"
                        type="button"
                        onClick={() => setClientTemplateMeta(null)}
                      >
                        Удалить
                      </button>
                    </div>
                  ) : null}

                  {clientTemplateError ? <p className="form-error">{clientTemplateError}</p> : null}

                  <label className="field">
                    <span>Выберите шаблон *</span>
                    <div className="template-dropdown" ref={templateDropdownRef}>
                      <button
                        className={`template-dropdown__trigger ${isTemplateDropdownOpen ? "open" : ""}`}
                        onClick={() => setIsTemplateDropdownOpen((prev) => !prev)}
                        type="button"
                        disabled={Boolean(clientTemplateMeta)}
                      >
                        <span className={selectedTemplate ? "" : "template-dropdown__placeholder"}>
                          {clientTemplateMeta
                            ? "Шаблон выбран через договор клиента"
                            : selectedTemplate
                              ? selectedTemplate.fileName
                              : "Выберите шаблон"}
                        </span>
                        <span className="template-dropdown__arrow" aria-hidden="true">
                          ▾
                        </span>
                      </button>

                      {isTemplateDropdownOpen ? (
                        <div className="template-dropdown__menu" role="listbox">
                          {availableTemplates.length === 0 ? (
                            <div className="template-dropdown__empty">Шаблонов пока нет.</div>
                          ) : (
                            availableTemplates.map((template) => (
                              <button
                                className={`template-option ${
                                  selectedTemplateId === template.id ? "active" : ""
                                }`}
                                key={template.id}
                                onClick={() => {
                                  setSelectedTemplateId(template.id);
                                  setComposeError(null);
                                  setIsTemplateDropdownOpen(false);
                                }}
                                type="button"
                              >
                                <span className="template-option__name">{template.fileName}</span>
                                <span className="template-option__meta">
                                  {formatFileSize(template.fileSize)} • {formatDate(template.uploadedAt)}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  </label>

                  {!clientTemplateMeta && availableTemplates.length === 0 ? (
                    <p className="form-error">
                      В разделе &quot;База знаний → Шаблоны&quot; пока нет документов. Сначала
                      добавьте шаблон.
                    </p>
                  ) : null}

                  {composeError ? <p className="form-error">{composeError}</p> : null}

                  <div className="modal-actions">
                    <button className="ghost-btn" onClick={closeComposeModal} type="button">
                      Отмена
                    </button>
                    <button
                      className="primary"
                      disabled={!clientTemplateMeta && availableTemplates.length === 0}
                      type="submit"
                    >
                      Открыть дело
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
        </section>
      );
    }

    return (
      <section className="workspace-stack">
        <div className="workspace-header">
          <h1>Работа с контрагентами</h1>
          <p>
            Здесь хранятся организации-клиенты. Откройте карточку организации для работы с
            договорами.
          </p>
          <div className="header-actions">
            <button className="primary" onClick={openCreateModal} type="button">
              Добавить организацию
            </button>
          </div>
        </div>

        {clients.length === 0 ? (
          <article className="card empty-organizations">
            <h3>Организаций пока нет</h3>
            <p className="muted-text">Добавьте первую организацию, чтобы начать ведение договоров.</p>
            <button className="primary" onClick={openCreateModal} type="button">
              Добавить новую организацию
            </button>
          </article>
        ) : (
          <div className="organization-grid">
            {clients.map((client) => (
              <button
                className="organization-card"
                key={client.id}
                onClick={() => openClient(client.id)}
                type="button"
              >
                <span className="organization-card__name">{client.companyName}</span>
                <span className="organization-card__meta">Создан: {formatDate(client.createdAt)}</span>
                {client.notes ? (
                  <span className="organization-card__notes">{client.notes}</span>
                ) : (
                  <span className="organization-card__notes organization-card__notes--muted">
                    Без заметок
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {isCreateModalOpen ? (
          <div className="modal-root" role="dialog" aria-modal="true" aria-label="Добавить организацию">
            <div className="modal-backdrop" onClick={closeCreateModal} />
            <div className="modal-card">
              <h3>Новая организация</h3>
              <form className="client-form" onSubmit={createClient}>
                <label className="field">
                  <span>Название компании *</span>
                  <input
                    autoFocus
                    onChange={(event) => setCompanyName(event.target.value)}
                    placeholder="ООО Ромашка"
                    type="text"
                    value={companyName}
                  />
                </label>

                <label className="field">
                  <span>Заметки (опционально)</span>
                  <textarea
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Любая информация о клиенте"
                    rows={5}
                    value={notes}
                  />
                </label>

                {formError ? <p className="form-error">{formError}</p> : null}

                <div className="modal-actions">
                  <button className="ghost-btn" onClick={closeCreateModal} type="button">
                    Отмена
                  </button>
                  <button className="primary" disabled={createClientBusy} type="submit">
                    {createClientBusy ? "Сохраняем..." : "Сохранить"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  function renderKnowledgeSection() {
    const templateDocs = knowledgeDocs.filter((doc) => doc.section === "templates");

    return (
      <section className="workspace-stack analysis-workspace">
        <div className="workspace-header">
          <h1>База знаний</h1>
          <p>
            Здесь хранится библиотека шаблонов договоров. Для каждого шаблона можно указать название и
            правила (контекст), которые будут учитываться при дальнейшей обработке.
          </p>
          <p className="scope-text">
            Контур хранения: tenant <b>{knowledgeScope.tenantId}</b> / agent <b>{knowledgeScope.agentId}</b>
          </p>
          <div className="header-actions">
            <button className="primary" onClick={() => setIsTemplateUploadModalOpen(true)} type="button">
              Добавить шаблон
            </button>
          </div>
        </div>

        <article className="card">
          <h3>Список шаблонов</h3>
          {templateDocs.length === 0 ? (
            <div className="knowledge-empty">
              Шаблонов пока нет. Нажмите &quot;Добавить шаблон&quot;, чтобы загрузить первый документ.
            </div>
          ) : (
            <div className="knowledge-doc-grid">
              {templateDocs.map((doc) => (
                <div className="knowledge-doc-card" key={doc.id}>
                  <div className="knowledge-doc-card__head">
                    <span className="knowledge-doc-card__name">{doc.fileName}</span>
                    <div className="knowledge-actions">
                      <button
                        className="ghost-btn ghost-btn--inline"
                        onClick={() => setTemplateDetailsId(doc.id)}
                        type="button"
                      >
                        Подробнее
                      </button>
                      {doc.fileUrl ? (
                        <a
                          className="ghost-btn ghost-btn--inline"
                          href={doc.fileUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Открыть
                        </a>
                      ) : null}
                      <button
                        className="knowledge-doc-card__remove"
                        onClick={() => removeKnowledgeDoc(doc.id)}
                        type="button"
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                  <div className="knowledge-doc-card__meta">
                    <span>{formatFileSize(doc.fileSize)}</span>
                    <span>{formatDate(doc.uploadedAt)}</span>
                    <span>{doc.mimeType}</span>
                    {doc.originalFileName ? <span>Файл: {doc.originalFileName}</span> : null}
                    {doc.sourceType ? <span>Тип: {doc.sourceType}</span> : null}
                    {Array.isArray(doc.tags) && doc.tags.length > 0 ? <span>Теги: {doc.tags.join(", ")}</span> : null}
                  </div>
                  <div className="knowledge-doc-card__rules">
                    {doc.rules?.trim()
                      ? doc.rules.length > 180
                        ? `${doc.rules.slice(0, 180)}…`
                        : doc.rules
                      : "Правила не указаны."}
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        {isTemplateUploadModalOpen ? (
          <div
            className="modal-root"
            role="dialog"
            aria-modal="true"
            aria-label="Добавить шаблон"
          >
            <div className="modal-backdrop" onClick={() => setIsTemplateUploadModalOpen(false)} />
            <div className="modal-card">
              <h3>Добавить шаблон</h3>
              <p className="muted-text">
                Загрузите документ и укажите человекочитаемое название. В поле &quot;Правила&quot; можно
                зафиксировать акценты (оплата, сроки, штрафы, расторжение и т.д.).
              </p>

              <form className="client-form" onSubmit={(event) => void uploadTemplate(event)}>
                <label className="field">
                  <span>Файл шаблона *</span>
                  <input
                    key={templateUploadFileKey}
                    onChange={(event) => setTemplateUploadFile(event.target.files?.[0] ?? null)}
                    type="file"
                  />
                </label>

                <label className="field">
                  <span>Название шаблона *</span>
                  <input
                    autoFocus
                    onChange={(event) => setTemplateUploadTitle(event.target.value)}
                    placeholder="Например: Шаблон договора поставки"
                    type="text"
                    value={templateUploadTitle}
                  />
                </label>

                <div className="workspace-grid">
                  <label className="field" style={{ gridColumn: "span 6" }}>
                    <span>Тип (опционально)</span>
                    <input
                      onChange={(event) => setTemplateUploadSourceType(event.target.value)}
                      placeholder="template"
                      type="text"
                      value={templateUploadSourceType}
                    />
                  </label>
                  <label className="field" style={{ gridColumn: "span 6" }}>
                    <span>Теги (через запятую)</span>
                    <input
                      onChange={(event) => setTemplateUploadTags(event.target.value)}
                      placeholder="поставка, оплата, штрафы"
                      type="text"
                      value={templateUploadTags}
                    />
                  </label>
                </div>

                <label className="field">
                  <span>Правила (опционально)</span>
                  <textarea
                    onChange={(event) => setTemplateUploadRules(event.target.value)}
                    placeholder="Например: при сравнении с шаблоном обращать внимание на оплату, сроки, штрафы и порядок расторжения."
                    rows={6}
                    value={templateUploadRules}
                  />
                </label>

                {templateUploadError ? <p className="form-error">{templateUploadError}</p> : null}

                <div className="modal-actions">
                  <button
                    className="ghost-btn"
                    onClick={() => setIsTemplateUploadModalOpen(false)}
                    type="button"
                  >
                    Отмена
                  </button>
                  <button className="primary" disabled={templateUploadBusy} type="submit">
                    {templateUploadBusy ? "Загружаем..." : "Добавить шаблон"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {templateDetailsDoc ? (
          <div
            className="modal-root"
            role="dialog"
            aria-modal="true"
            aria-label="Шаблон"
          >
            <div className="modal-backdrop" onClick={closeTemplateDetails} />
            <div className="modal-card">
              {!templateDetailsEditing ? (
                <>
                  <h3>{templateDetailsDoc.fileName}</h3>
                  <div className="knowledge-meta-list">
                    <div className="knowledge-meta-item">
                      <strong>Тип:</strong> {templateDetailsDoc.sourceType || "template"}
                    </div>
                    <div className="knowledge-meta-item">
                      <strong>Теги:</strong>{" "}
                      {Array.isArray(templateDetailsDoc.tags) && templateDetailsDoc.tags.length > 0
                        ? templateDetailsDoc.tags.join(", ")
                        : "—"}
                    </div>
                    <div className="knowledge-meta-item">
                      <strong>Файл:</strong> {templateDetailsDoc.originalFileName || "—"}
                    </div>
                    <div className="knowledge-meta-item">
                      <strong>Загружен:</strong> {formatDate(templateDetailsDoc.uploadedAt)}
                    </div>
                    <div className="knowledge-meta-item">
                      <strong>Размер:</strong> {formatFileSize(templateDetailsDoc.fileSize)}
                    </div>
                    <div className="knowledge-meta-item">
                      <strong>MIME:</strong> {templateDetailsDoc.mimeType}
                    </div>
                  </div>

                  <h3 style={{ marginTop: 14 }}>Правила</h3>
                  <div className="knowledge-doc-card__rules">
                    {templateDetailsDoc.rules?.trim() ? templateDetailsDoc.rules : "Правила не указаны."}
                  </div>

                  <div className="modal-actions">
                    <button className="ghost-btn" onClick={closeTemplateDetails} type="button">
                      Закрыть
                    </button>
                    <button className="ghost-btn" onClick={startTemplateDetailsEdit} type="button">
                      Редактировать
                    </button>
                    {templateDetailsDoc.fileUrl ? (
                      <a
                        className="primary"
                        href={templateDetailsDoc.fileUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Открыть файл
                      </a>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <h3>Редактирование</h3>
                  <form
                    className="client-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveTemplateDetails();
                    }}
                  >
                    <label className="field">
                      <span>Название *</span>
                      <input
                        autoFocus
                        onChange={(event) => setTemplateDetailsTitle(event.target.value)}
                        type="text"
                        value={templateDetailsTitle}
                      />
                    </label>

                    <div className="workspace-grid">
                      <label className="field" style={{ gridColumn: "span 6" }}>
                        <span>Тип</span>
                        <input
                          onChange={(event) => setTemplateDetailsSourceType(event.target.value)}
                          type="text"
                          value={templateDetailsSourceType}
                        />
                      </label>
                      <label className="field" style={{ gridColumn: "span 6" }}>
                        <span>Теги (через запятую)</span>
                        <input
                          onChange={(event) => setTemplateDetailsTags(event.target.value)}
                          type="text"
                          value={templateDetailsTags}
                        />
                      </label>
                    </div>

                    <label className="field">
                      <span>Правила</span>
                      <textarea
                        onChange={(event) => setTemplateDetailsRules(event.target.value)}
                        rows={8}
                        value={templateDetailsRules}
                      />
                    </label>

                    {templateDetailsError ? <p className="form-error">{templateDetailsError}</p> : null}

                    <div className="modal-actions">
                      <button className="ghost-btn" onClick={cancelTemplateDetailsEdit} type="button">
                        Отмена
                      </button>
                      <button className="primary" type="submit">
                        Сохранить
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  function renderAnalysisSection() {
    const active =
      analysisActiveId ? analysisCases.find((item) => item.id === analysisActiveId) ?? null : null;

    const comments = Array.isArray(active?.aiComments) ? active!.aiComments! : [];

    const canAnalyze = Boolean(analysisUploadFile) && !analysisUploadBusy;

    return (
      <section className="workspace-stack workspace-stack--scroll">
        <div className="workspace-header">
          <h1>Анализ рисков</h1>
          <p>
            Загрузите документ контрагента. Отправим его на платформу и получим: комментарии по рискам и заготовку
            протокола разногласий (наша редакция предложений).
          </p>
          <div className="header-actions">
            <button className="primary" type="button" onClick={() => setIsAnalysisUploadModalOpen(true)}>
              Новый анализ
            </button>
          </div>
        </div>

        <div className="analysis-grid">
          <aside className="analysis-left">
            <article className="card analysis-list-card">
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <h3 style={{ margin: 0 }}>История</h3>
                {analysisCases.length > 0 ? (
                  <button className="ghost-btn ghost-btn--inline" type="button" onClick={clearAnalysisHistory}>
                    Очистить
                  </button>
                ) : null}
              </div>
              {analysisCases.length === 0 ? (
                <p className="muted-text">Пока нет анализов. Загрузите первый документ.</p>
              ) : (
                <div className="analysis-list">
                  {analysisCases.map((item) => (
                    <div
                      key={item.id}
                      className={`analysis-item ${analysisActiveId === item.id ? "active" : ""}`}
                      onClick={() => openAnalysisCase(item.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openAnalysisCase(item.id);
                        }
                      }}
                    >
                      <span style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start" }}>
                        <span className="analysis-item__title">{item.title}</span>
                        <button
                          className="ghost-btn ghost-btn--inline"
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            deleteAnalysisCase(item.id);
                          }}
                          aria-label="Удалить анализ"
                          title="Удалить"
                        >
                          ×
                        </button>
                      </span>
                      <div className="analysis-item__meta">{formatDate(item.createdAt)}</div>
                      <div className="analysis-item__meta muted-text">{item.sourceFileName}</div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </aside>

          <section className="analysis-main">
            <article className="card analysis-panel">
              <div className="analysis-head">
                <div>
                  <h3>{active ? active.title : "Результат анализа"}</h3>
                  {active ? (
                    <div className="analysis-head__meta">
                      <span className="muted-text">
                        Файл: <b>{active.sourceFileName}</b> ({formatFileSize(active.sourceFileSize)}) •{" "}
                        {formatDate(active.createdAt)}
                      </span>
                    </div>
                  ) : (
                    <div className="analysis-head__meta">
                      <span className="muted-text">
                        Выберите анализ из истории или загрузите документ, чтобы увидеть комментарии и протокол.
                      </span>
                    </div>
                  )}
                </div>
                <div className="analysis-head__actions">
                  {active ? (
                    <>
                      <a
                        className="ghost-btn ghost-btn--inline"
                        href={active.sourceFileUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Открыть документ
                      </a>
                      <button
                        className="ghost-btn ghost-btn--inline"
                        type="button"
                        disabled={analysisRunBusy}
                        onClick={() => void runRiskAnalysis(active.id)}
                      >
                        {analysisRunBusy ? "Отправляем..." : "Запустить ещё раз"}
                      </button>
                      <button
                        className="ghost-btn ghost-btn--inline"
                        type="button"
                        onClick={() => setIsAnalysisUploadModalOpen(true)}
                      >
                        Новый анализ
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              {analysisRunError ? <p className="form-error" style={{ marginTop: 10 }}>{analysisRunError}</p> : null}
              {analysisRunBusy ? (
                <div className="contract-ai-processing" style={{ marginTop: 10 }}>
                  <div className="contract-ai-processing__spinner" aria-hidden="true" />
                  <div className="contract-ai-processing__text">
                    <strong>Идёт обработка на платформе</strong>
                    <span>
                      Ждём ответ
                      <span className="contract-ai-processing__dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                    </span>
                  </div>
                  <span className="muted-text" style={{ fontSize: 12 }}>
                    до 3 минут
                  </span>
                </div>
              ) : null}

              <div className="analysis-tabs">
                <button
                  className={`analysis-tab ${analysisActiveTab === "ai" ? "active" : ""}`}
                  type="button"
                  onClick={() => setAnalysisActiveTab("ai")}
                  disabled={!active}
                >
                  Комментарий
                </button>
                <button
                  className={`analysis-tab ${analysisActiveTab === "protocol" ? "active" : ""}`}
                  type="button"
                  onClick={() => setAnalysisActiveTab("protocol")}
                  disabled={!active}
                >
                  Протокол
                </button>
                <button
                  className={`analysis-tab ${analysisActiveTab === "text" ? "active" : ""}`}
                  type="button"
                  onClick={() => setAnalysisActiveTab("text")}
                  disabled={!active}
                >
                  Текст
                </button>
              </div>

              <div className="analysis-panel__body">
                {!active ? (
                  <p className="muted-text">
                    Здесь появится результат: общий комментарий по рискам, таблица протокола разногласий и извлечённый
                    текст документа.
                  </p>
                ) : analysisActiveTab === "protocol" ? (
                  <>
                    <p className="muted-text">
                      Таблица протокола разногласий (можно править). Пока перенос в “Открытое дело” — позже.
                    </p>

                    {analysisProtocolDraft.length === 0 ? (
                      <p className="muted-text">Пока нет строк протокола.</p>
                    ) : (
                      <div className="analysis-protocol-table">
                        <div className="analysis-protocol-row analysis-protocol-row--head">
                          <div>Пункт</div>
                          <div>Редакция контрагента</div>
                          <div>Наша редакция</div>
                        </div>
                        {analysisProtocolDraft.map((row, index) => (
                          <div className="analysis-protocol-row" key={`${row.clause}-${index}`}>
                            <input
                              value={row.clause}
                              onChange={(e) =>
                                setAnalysisProtocolDraft((prev) =>
                                  prev.map((item, idx) =>
                                    idx === index ? { ...item, clause: e.target.value } : item,
                                  ),
                                )
                              }
                            />
                            <textarea
                              rows={3}
                              value={row.clientText}
                              onChange={(e) =>
                                setAnalysisProtocolDraft((prev) =>
                                  prev.map((item, idx) =>
                                    idx === index ? { ...item, clientText: e.target.value } : item,
                                  ),
                                )
                              }
                            />
                            <textarea
                              rows={3}
                              value={row.ourText}
                              onChange={(e) =>
                                setAnalysisProtocolDraft((prev) =>
                                  prev.map((item, idx) =>
                                    idx === index ? { ...item, ourText: e.target.value } : item,
                                  ),
                                )
                              }
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="analysis-protocol-actions">
                      <button
                        className="ghost-btn"
                        type="button"
                        onClick={() =>
                          setAnalysisProtocolDraft((prev) => [
                            ...prev,
                            { clause: "", clientText: "", ourText: "" },
                          ])
                        }
                      >
                        Добавить строку
                      </button>
                      <button className="ghost-btn" type="button" onClick={saveAnalysisProtocolDraft}>
                        Сохранить строки
                      </button>
                      <button className="primary" disabled type="button">
                        Добавить в протокол разногласий (скоро)
                      </button>
                    </div>
                  </>
                ) : analysisActiveTab === "text" ? (
                  <>
                    <p className="muted-text">
                      Для прозрачности: что именно попадёт в анализ. Показываем извлечённый текст (если удалось).
                    </p>
                    <pre className="analysis-text">
                      {active.extractedText?.trim() ? active.extractedText : "Текст не извлечён."}
                    </pre>
                  </>
                ) : (
                  <>
                    <p className="muted-text">
                      Здесь будет общий вывод и список рисков (позже — на базе ФЗ/практики из платформы). Сейчас — мок.
                    </p>
                    {active.aiSummary ? <p className="analysis-summary">{active.aiSummary}</p> : null}
                    {comments.length === 0 ? (
                      <p className="muted-text">Пока нет комментариев.</p>
                    ) : (
                      <div className="analysis-comments">
                        {comments.map((c) => (
                          <div key={c.id} className={`analysis-comment ${severityClass(c.severity)}`}>
                            <div className="analysis-comment__head">
                              <strong>{c.title}</strong>
                              <span className="muted-text">{severityLabel(c.severity)}</span>
                            </div>
                            <p>{c.details}</p>
                            {c.basis ? <p className="muted-text">Основание: {c.basis}</p> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </article>
          </section>
        </div>

        {isAnalysisUploadModalOpen ? (
          <div className="modal-root" role="dialog" aria-modal="true" aria-label="Новый анализ">
            <div
              className="modal-backdrop"
              onClick={() => {
                setIsAnalysisUploadModalOpen(false);
                setAnalysisUploadError(null);
                setAnalysisTitle("");
                setAnalysisUploadFile(null);
                setAnalysisUploadFileKey((value) => value + 1);
              }}
            />
            <div className="modal-card">
              <h3>Новый анализ</h3>
              <p className="muted-text">
                Загрузите документ контрагента. Пока без реальной обработки ИИ — только интерфейс и мок результата.
              </p>

              <form className="client-form" onSubmit={(event) => void uploadAnalysisDocument(event)}>
                <label className="field">
                  <span>Документ контрагента *</span>
                  <input
                    key={analysisUploadFileKey}
                    onChange={(event) => setAnalysisUploadFile(event.target.files?.[0] ?? null)}
                    type="file"
                  />
                </label>

                <label className="field">
                  <span>Название (опционально)</span>
                  <input
                    onChange={(event) => setAnalysisTitle(event.target.value)}
                    placeholder="Например: Договор поставки — Контрагент X"
                    type="text"
                    value={analysisTitle}
                  />
                </label>

                {analysisUploadError ? <p className="form-error">{analysisUploadError}</p> : null}

                <div className="modal-actions">
                  <button
                    className="ghost-btn"
                    onClick={() => {
                      setIsAnalysisUploadModalOpen(false);
                      setAnalysisUploadError(null);
                      setAnalysisTitle("");
                      setAnalysisUploadFile(null);
                      setAnalysisUploadFileKey((value) => value + 1);
                    }}
                    type="button"
                  >
                    Отмена
                  </button>
                  <button className="primary" disabled={!canAnalyze} type="submit">
                    {analysisUploadBusy ? "Обрабатываем..." : "Запустить анализ"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  function renderDashboardSection() {
    const templatesCount = knowledgeDocs.filter((doc) => doc.section === "templates").length;
    const activeContracts = contracts.filter((item) => item.status === "draft");
    const archivedContracts = contracts.filter((item) => item.status === "archived");
    const finalizedContracts = contracts.filter((item) => item.status === "finalized");

    const recentContracts = [...contracts]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6);

    const maxBar = Math.max(activeContracts.length, archivedContracts.length, finalizedContracts.length, 1);

    return (
      <section className="workspace-stack workspace-stack--scroll">
        <div className="workspace-header">
          <h1>Дашборд</h1>
          <p>Быстрый обзор и навигация по работе: контрагенты, договоры и шаблоны.</p>
        </div>

        <div className="dashboard-grid">
          <article className="card dashboard-stat">
            <div className="dashboard-stat__label">Контрагенты</div>
            <div className="dashboard-stat__value">{clients.length}</div>
            <div className="dashboard-stat__hint">Всего организаций в работе.</div>
          </article>
          <article className="card dashboard-stat">
            <div className="dashboard-stat__label">Шаблоны</div>
            <div className="dashboard-stat__value">{templatesCount}</div>
            <div className="dashboard-stat__hint">Шаблоны договоров в базе знаний.</div>
          </article>
          <article className="card dashboard-stat">
            <div className="dashboard-stat__label">Открытые дела</div>
            <div className="dashboard-stat__value">{activeContracts.length}</div>
            <div className="dashboard-stat__hint">Договоры в согласовании.</div>
          </article>

          <article className="card dashboard-chart">
            <h3>Статусы договоров</h3>
            <div className="dashboard-bars">
              {[
                { label: "Открытые дела", value: activeContracts.length, className: "ok" },
                { label: "Архив", value: archivedContracts.length, className: "warn" },
                { label: "Завершены", value: finalizedContracts.length, className: "accent" },
              ].map((item) => (
                <div key={item.label} className="dashboard-bar">
                  <div className="dashboard-bar__head">
                    <span>{item.label}</span>
                    <span className="muted-text">{item.value}</span>
                  </div>
                  <div className="dashboard-bar__track">
                    <div
                      className={`dashboard-bar__fill dashboard-bar__fill--${item.className}`}
                      style={{ width: `${Math.round((item.value / maxBar) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="card dashboard-recent">
            <h3>Последние договоры</h3>
            {recentContracts.length === 0 ? (
              <p className="muted-text">Пока нет договоров. Откройте первое дело у контрагента.</p>
            ) : (
              <div className="dashboard-recent__list">
                {recentContracts.map((c) => (
                  <Link key={c.id} className="dashboard-recent__item" href={`/contracts/${c.id}`}>
                    <div className="dashboard-recent__title">{c.templateName}</div>
                    <div className="dashboard-recent__meta">
                      {formatDate(c.createdAt)} • {c.status === "draft" ? "открытое дело" : c.status === "archived" ? "архив" : "завершен"}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </article>
        </div>
      </section>
    );
  }

  if (!hydrated) {
    return (
      <div className="app-shell">
        <aside className="sidebar" />
        <main className="workspace" />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-main">
          <div className="brand">
            <div>
              <h1 className="brand__title">Jurist3</h1>
              <span className="brand__tag">Документооборот и согласование договоров</span>
            </div>
          </div>

          <section className="sidebar-block">
            <h2>Разделы</h2>
            <div className="sidebar-nav">
              {navItems.map((item) => (
                <button
                  className={activeSection === item.id ? "active" : ""}
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>
        </div>

        <section className="sidebar-block sidebar-logout">
          <button className="ghost-btn" onClick={handleLogout} type="button">
            Выйти
          </button>
        </section>
      </aside>

      <main className="workspace">
        {activeSection === "dashboard" ? renderDashboardSection() : null}
        {activeSection === "contracts" ? renderContractsSection() : null}
        {activeSection === "analysis" ? renderAnalysisSection() : null}
        {activeSection === "knowledge" ? renderKnowledgeSection() : null}
      </main>
    </div>
  );
}
