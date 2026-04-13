"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { AiAnalysisResult, ContractDraft, ContractIterationAttachment } from "@/lib/contracts/types";
import { OnlyOfficeViewer } from "@/components/contracts/OnlyOfficeViewer";
import type { KnowledgeDocument, KnowledgeScope } from "@/lib/knowledge/types";

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

export function ContractPageClient() {
  const params = useParams<{ contractId: string }>();
  const contractId = params.contractId;
  const [hydrated, setHydrated] = useState(false);
  const selectedIterationStorageKey = `jurist3.contract.selected-iteration:${contractId}`;
  const knowledgeScope: KnowledgeScope = {
    tenantId: process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID ?? "local-tenant",
    agentId: process.env.NEXT_PUBLIC_PLATFORM_AGENT_ID ?? "jurist3-agent",
  };

  const [contracts, setContracts] = useState<ContractDraft[]>([]);
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDocument[]>([]);

  const contract = useMemo(
    () => contracts.find((item) => item.id === contractId) ?? null,
    [contracts, contractId],
  );

  const [selectedIterationId, setSelectedIterationId] = useState<string | null>(null);
  const [activeDocTab, setActiveDocTab] = useState<"template" | "protocol" | "agreed">("template");

  const [isIterationModalOpen, setIsIterationModalOpen] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [attachments, setAttachments] = useState<ContractIterationAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [iterationModalError, setIterationModalError] = useState<string | null>(null);

  const [aiItemResponses, setAiItemResponses] = useState<Record<string, string>>({});
  const [responseError, setResponseError] = useState<string | null>(null);

  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [protocolError, setProtocolError] = useState<string | null>(null);
  const [isProtocolUpdating, setIsProtocolUpdating] = useState(false);
  const [responseGenerationError, setResponseGenerationError] = useState<string | null>(null);

  function redirectToLogin() {
    window.location.href = "/login";
  }

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const headers = {
      "x-tenant-id": knowledgeScope.tenantId,
      "x-agent-id": knowledgeScope.agentId,
    };
    void (async () => {
      const [contractsRes, knowledgeRes] = await Promise.all([
        fetch("/api/storage/contracts", { headers }),
        fetch("/api/storage/knowledge", { headers }),
      ]);
      if (contractsRes.status === 401 || knowledgeRes.status === 401) {
        redirectToLogin();
        return;
      }
      const contractsPayload = (await contractsRes.json().catch(() => null)) as { items?: ContractDraft[] } | null;
      const knowledgePayload = (await knowledgeRes.json().catch(() => null)) as { items?: KnowledgeDocument[] } | null;
      if (contractsPayload?.items) setContracts(contractsPayload.items);
      if (knowledgePayload?.items) setKnowledgeDocs(knowledgePayload.items);
    })();
  }, [hydrated]);

  const selectedIteration = useMemo(
    () => contract?.iterations.find((item) => item.id === selectedIterationId) ?? null,
    [contract, selectedIterationId],
  );

  const clientIterations = useMemo(
    () => (contract ? contract.iterations.filter((item) => item.kind === "client-request") : []),
    [contract],
  );

  useEffect(() => {
    if (!hydrated || !contract) {
      return;
    }

    const iterationIds = new Set(contract.iterations.map((item) => item.id));
    const savedIterationId = window.sessionStorage.getItem(selectedIterationStorageKey);
    const hasValidSelected = Boolean(selectedIterationId && iterationIds.has(selectedIterationId));

    if (hasValidSelected) {
      return;
    }

    if (savedIterationId && iterationIds.has(savedIterationId)) {
      setSelectedIterationId(savedIterationId);
      return;
    }

    const fallbackId =
      clientIterations[clientIterations.length - 1]?.id ?? contract.iterations[0]?.id ?? null;
    setSelectedIterationId(fallbackId);
  }, [hydrated, contract, selectedIterationId, selectedIterationStorageKey, clientIterations]);

  useEffect(() => {
    if (!hydrated || !selectedIterationId) {
      return;
    }

    window.sessionStorage.setItem(selectedIterationStorageKey, selectedIterationId);
  }, [hydrated, selectedIterationId, selectedIterationStorageKey]);

  const selectedClientIteration = useMemo(() => {
    if (selectedIteration?.kind === "client-request") {
      return selectedIteration;
    }
    return clientIterations[clientIterations.length - 1] ?? null;
  }, [selectedIteration, clientIterations]);

  const selectedClientIterationIndex = useMemo(() => {
    if (!contract || !selectedClientIteration) {
      return -1;
    }
    return contract.iterations.findIndex((item) => item.id === selectedClientIteration.id);
  }, [contract, selectedClientIteration]);

  const effectiveTemplateFileUrl = useMemo(() => {
    if (!contract) {
      return undefined;
    }

    if (contract.templateFileUrl) {
      return contract.templateFileUrl;
    }

    return knowledgeDocs.find((doc) => doc.id === contract.templateDocId)?.fileUrl;
  }, [contract, knowledgeDocs]);

  const protocolAttachment = useMemo(() => {
    const currentAttachments = selectedIteration?.attachments ?? [];
    if (currentAttachments.length > 0) {
      const byName = currentAttachments.find((item) =>
        item.fileName.toLowerCase().includes("protocol") || item.fileName.toLowerCase().includes("разноглас"),
      );
      return byName ?? currentAttachments[0];
    }

    const fromIteration = selectedClientIteration?.attachments ?? [];
    if (fromIteration.length > 0) {
      const byName = fromIteration.find((item) =>
        item.fileName.toLowerCase().includes("protocol") || item.fileName.toLowerCase().includes("разноглас"),
      );
      return byName ?? fromIteration[0];
    }

    if (!contract) {
      return null;
    }

    for (let index = contract.iterations.length - 1; index >= 0; index -= 1) {
      const attachments = contract.iterations[index]?.attachments ?? [];
      const byName = attachments.find((item) =>
        item.fileName.toLowerCase().includes("protocol") || item.fileName.toLowerCase().includes("разноглас"),
      );
      if (byName) {
        return byName;
      }
    }

    return null;
  }, [selectedIteration, selectedClientIteration, contract]);

  const responseIteration = useMemo(() => {
    if (!contract || selectedClientIterationIndex < 0) {
      return null;
    }
    const nextResponse = contract.iterations.find(
      (item, index) => index > selectedClientIterationIndex && item.kind === "company-response",
    );
    return nextResponse ?? null;
  }, [contract, selectedClientIterationIndex]);

  const responseAttachment = useMemo(() => {
    if (!responseIteration?.attachments?.length) {
      return null;
    }
    return responseIteration.attachments[0];
  }, [responseIteration]);

  const activeDocumentSource = useMemo(() => {
    if (activeDocTab === "template") {
      if (!effectiveTemplateFileUrl || !contract) {
        return null;
      }
      return {
        fileName: contract.templateName,
        fileUrl: effectiveTemplateFileUrl,
      };
    }
    if (activeDocTab === "protocol") {
      if (!protocolAttachment) {
        return null;
      }
      return {
        fileName: protocolAttachment.fileName,
        fileUrl: protocolAttachment.fileUrl,
      };
    }
    if (activeDocTab === "agreed") {
      if (!responseAttachment) {
        return null;
      }
      return {
        fileName: responseAttachment.fileName,
        fileUrl: responseAttachment.fileUrl,
      };
    }
    return null;
  }, [activeDocTab, effectiveTemplateFileUrl, contract, protocolAttachment, responseAttachment]);

  const canOpenClientIterationModal = Boolean(contract);

  useEffect(() => {
    if (selectedClientIteration?.kind !== "client-request") {
      setAiItemResponses({});
      setResponseError(null);
      return;
    }

    const draft = selectedClientIteration.responseDraft ?? {};
    const aiItems = selectedClientIteration.aiAnalysis?.items ?? [];
    setAiItemResponses(() => {
      if (aiItems.length === 0) {
        return { ...draft };
      }
      const next: Record<string, string> = {};
      aiItems.forEach((item) => {
        next[item.id] = draft[item.id] ?? "";
      });
      return next;
    });
    setResponseError(null);
  }, [selectedClientIteration]);


  function updateAiItemResponse(itemId: string, value: string) {
    if (!contract || !selectedClientIteration || selectedClientIteration.kind !== "client-request") {
      return;
    }

    setAiItemResponses((prev) => {
      const next = {
        ...prev,
        [itemId]: value,
      };

    setContracts((contractsPrev) => {
        const contractsNext = contractsPrev.map((item) =>
          item.id === contract.id
            ? {
                ...item,
                iterations: item.iterations.map((iteration) =>
                  iteration.id === selectedClientIteration.id
                    ? {
                        ...iteration,
                        responseDraft: next,
                      }
                    : iteration,
                ),
              }
            : item,
        );
        if (hydrated) {
          const headers = {
            "Content-Type": "application/json",
            "x-tenant-id": knowledgeScope.tenantId,
            "x-agent-id": knowledgeScope.agentId,
          };
          void fetch("/api/storage/contracts", { method: "POST", headers, body: JSON.stringify({ items: contractsNext }) });
        }
        return contractsNext;
      });

      return next;
    });
  }

  function updateContracts(next: ContractDraft[]) {
    setContracts(next);
    if (hydrated) {
      const headers = {
        "Content-Type": "application/json",
        "x-tenant-id": knowledgeScope.tenantId,
        "x-agent-id": knowledgeScope.agentId,
      };
      void fetch("/api/storage/contracts", { method: "POST", headers, body: JSON.stringify({ items: next }) });
    }
  }

  function openIterationModal() {
    if (!canOpenClientIterationModal) {
      return;
    }

    setIsIterationModalOpen(true);
    setRequestText("");
    setAttachments([]);
    setIterationModalError(null);
    setAiError(null);
  }

  function closeIterationModal() {
    setIsIterationModalOpen(false);
    setIterationModalError(null);
  }

  async function uploadAttachment(file: File): Promise<ContractIterationAttachment | null> {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/contracts/upload", {
        method: "POST",
        body: formData,
      });
      if (response.status === 401) {
        redirectToLogin();
        return null;
      }
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as { fileUrl?: string };
      if (!payload.fileUrl) {
        return null;
      }

      return {
        id: crypto.randomUUID(),
        fileName: file.name,
        fileUrl: payload.fileUrl,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        uploadedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  async function handleAttachmentSelect(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    setIsUploading(true);
    setIterationModalError(null);

    const next: ContractIterationAttachment[] = [];
    const failed: string[] = [];

    for (const file of Array.from(fileList)) {
      const uploaded = await uploadAttachment(file);
      if (!uploaded) {
        failed.push(file.name);
      } else {
        next.push(uploaded);
      }
    }

    setAttachments((prev) => [...prev, ...next]);

    if (failed.length > 0) {
      setIterationModalError(`Не удалось загрузить: ${failed.join(", ")}`);
    }

    setIsUploading(false);
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  }

  async function runAiAnalysisForData(
    iterationId: string,
    input: { requestText: string; attachments: ContractIterationAttachment[] },
  ) {
    if (!contract) {
      return;
    }

    setIsAiAnalyzing(true);
    setAiError(null);

    try {
      const response = await fetch("/api/ai/analyze-iteration", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contractTemplateName: contract.templateName,
          contractTemplateFileUrl: effectiveTemplateFileUrl,
          requestText: input.requestText,
          attachments: input.attachments,
          knowledgeDocs: knowledgeDocs
            .filter((item) => item.section === "rules" || item.section === "fz")
            .filter((item) => Boolean(item.fileUrl))
            .map((item) => ({
              section: item.section,
              fileName: item.fileName,
              fileUrl: item.fileUrl,
            })),
        }),
      });

      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { details?: string } | null;
        throw new Error(errorPayload?.details || "AI analyze failed");
      }

      const analysis = (await response.json()) as AiAnalysisResult;
      setContracts((prev) => {
        const next = prev.map((item) =>
          item.id === contract.id
            ? {
                ...item,
                iterations: item.iterations.map((iteration) =>
                  iteration.id === iterationId
                    ? {
                        ...iteration,
                        aiAnalysis: analysis,
                      }
                    : iteration,
                ),
              }
            : item,
        );
        if (hydrated) {
          const headers = {
            "Content-Type": "application/json",
            "x-tenant-id": knowledgeScope.tenantId,
            "x-agent-id": knowledgeScope.agentId,
          };
          void fetch("/api/storage/contracts", { method: "POST", headers, body: JSON.stringify({ items: next }) });
        }
        return next;
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : "unknown error";
      setAiError(`Не удалось выполнить ИИ-анализ. ${details}`);
    } finally {
      setIsAiAnalyzing(false);
    }
  }

  async function runDisagreementProtocolGeneration(
    iterationId: string,
    input: { requestText: string; attachments: ContractIterationAttachment[] },
  ) {
    if (!contract) {
      return;
    }

    setProtocolError(null);

    try {
      const response = await fetch("/api/contracts/generate-disagreement", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contractId: contract.id,
          iterationId,
          requestText: input.requestText,
          attachments: input.attachments.map((item) => ({
            fileName: item.fileName,
            fileUrl: item.fileUrl,
          })),
          template: null,
          contractTemplate: contract.templateFileUrl
            ? {
                fileName: contract.templateName,
                fileUrl: contract.templateFileUrl,
              }
            : null,
        }),
      });

      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
        setProtocolError(errorPayload?.error || "Не удалось сформировать протокол разногласий.");
        return;
      }

      const payload = (await response.json()) as {
        fileName?: string;
        fileUrl?: string;
        content?: string;
        mimeType?: string;
      };
      if (!payload.fileName || !payload.fileUrl) {
        setProtocolError("Протокол сформирован некорректно. Попробуйте ещё раз.");
        return;
      }

      const protocolAttachment: ContractIterationAttachment = {
        id: crypto.randomUUID(),
        fileName: payload.fileName,
        fileUrl: payload.fileUrl,
        fileSize: payload.content ? new Blob([payload.content]).size : 0,
        mimeType: payload.mimeType || "application/octet-stream",
        uploadedAt: new Date().toISOString(),
      };

      setContracts((prev) => {
        const next = prev.map((item) =>
          item.id === contract.id
            ? {
                ...item,
                iterations: item.iterations.map((iteration) => {
                  if (iteration.id !== iterationId) {
                    return iteration;
                  }

                  const existing = iteration.attachments || [];
                  const withoutOldProtocol = existing.filter(
                    (attachment) => !attachment.fileName.includes("-protocol-disagreement.txt"),
                  );

                  return {
                    ...iteration,
                    content: payload.content || iteration.content,
                    attachments: [protocolAttachment, ...withoutOldProtocol],
                  };
                }),
              }
            : item,
        );
        if (hydrated) {
          const headers = {
            "Content-Type": "application/json",
            "x-tenant-id": knowledgeScope.tenantId,
            "x-agent-id": knowledgeScope.agentId,
          };
          void fetch("/api/storage/contracts", { method: "POST", headers, body: JSON.stringify({ items: next }) });
        }
        return next;
      });
    } catch {
      setProtocolError("Ошибка сети при формировании протокола разногласий.");
    }
  }

  async function createClientRequestIteration() {
    if (!contract) {
      return;
    }

    if (isUploading) {
      setIterationModalError("Дождитесь завершения загрузки файлов.");
      return;
    }

    if (!requestText.trim() && attachments.length === 0) {
      setIterationModalError("Добавьте описание правок или прикрепите файл.");
      return;
    }

    const attachmentList =
      attachments.length === 0
        ? ""
        : `\n\nВложения:\n${attachments.map((item) => `- ${item.fileName}`).join("\n")}`;

    const newIteration = {
      id: crypto.randomUUID(),
      title: "Запрос клиента по правкам",
      content:
        `Описание запроса:\n${requestText.trim() || "(только вложения)"}` +
        `${attachmentList}\n\nПередано в ИИ анализ для подготовки протокола разногласий.`,
      updatedAt: new Date().toISOString(),
      kind: "client-request" as const,
      clientDecision: "changes" as const,
      requestText: requestText.trim(),
      attachments,
      nextAction: "prepare-disagreement-protocol" as const,
    };

    const nextContracts = contracts.map((item) =>
      item.id === contract.id
        ? {
            ...item,
            iterations: [...item.iterations, newIteration],
          }
        : item,
    );

    updateContracts(nextContracts);
    setSelectedIterationId(newIteration.id);
    setActiveDocTab("protocol");
    closeIterationModal();
    await runAiAnalysisForData(newIteration.id, {
      requestText: newIteration.requestText || newIteration.content,
      attachments: newIteration.attachments || [],
    });
    await runDisagreementProtocolGeneration(newIteration.id, {
      requestText: newIteration.requestText || newIteration.content,
      attachments: newIteration.attachments || [],
    });
  }

  function createCompanyResponseIteration() {
    if (!contract || !selectedClientIteration || selectedClientIteration.kind !== "client-request") {
      return;
    }

    const aiItems = selectedClientIteration.aiAnalysis?.items ?? [];
    const hasAnyResponse = aiItems.some((item) => (aiItemResponses[item.id] || "").trim().length > 0);
    if (!hasAnyResponse) {
      setResponseError("Добавьте ответ хотя бы к одному комментарию ИИ.");
      return;
    }

      void (async () => {
        try {
          setIsProtocolUpdating(true);
          setResponseGenerationError(null);
        const updates = aiItems
          .map((item) => ({
            clause: item.section || "",
            ourText: (aiItemResponses[item.id] || "").trim(),
          }))
          .filter((item) => item.clause && item.ourText);

        if (updates.length === 0) {
          setResponseError("Добавьте ответ хотя бы к одному комментарию ИИ.");
          return;
        }

          if (!protocolAttachment) {
            setResponseGenerationError("Протокол разногласий пока не сформирован.");
            return;
          }

          const response = await fetch("/api/contracts/update-protocol", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contractId: contract.id,
              iterationId: selectedClientIteration.id,
              protocolFileUrl: protocolAttachment.fileUrl,
              updates,
            }),
          });

        if (response.status === 401) {
          redirectToLogin();
          return;
        }
        if (!response.ok) {
          const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
          setResponseGenerationError(errorPayload?.error || "Не удалось сформировать ответ.");
          return;
        }

        const payload = (await response.json()) as { fileName?: string; fileUrl?: string };
        if (!payload.fileName || !payload.fileUrl) {
          setResponseGenerationError("Ответ сформирован некорректно.");
          return;
        }

          const updatedAttachment: ContractIterationAttachment = {
            id: crypto.randomUUID(),
            fileName: payload.fileName,
            fileUrl: payload.fileUrl,
            fileSize: 0,
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            uploadedAt: new Date().toISOString(),
          };

          const nextContracts = contracts.map((item) =>
            item.id === contract.id
              ? {
                  ...item,
                  iterations: item.iterations.map((iteration) => {
                    if (iteration.id !== selectedClientIteration.id) {
                      return iteration;
                    }

                    return {
                      ...iteration,
                      attachments: [
                        updatedAttachment,
                        ...((iteration.attachments || []).filter(
                          (attachment) =>
                            !attachment.fileName.toLowerCase().includes("protocol") &&
                            !attachment.fileName.toLowerCase().includes("разноглас"),
                        )),
                      ],
                      responseDraft: aiItemResponses,
                    };
                  }),
                }
              : item,
          );

          updateContracts(nextContracts);
          setResponseError(null);
        } finally {
          setIsProtocolUpdating(false);
        }
      })();
    }

  if (!hydrated) {
    return (
      <main className="contract-page">
        <div className="contract-layout">
          <section className="contract-main" />
        </div>
      </main>
    );
  }

  if (!contract) {
    return (
      <main className="contract-page">
        <div className="contract-layout">
          <section className="contract-main">
            <h1>Договор не найден</h1>
            <p className="muted-text">Возможно, черновик был удален.</p>
            <Link className="ghost-btn ghost-btn--inline" href="/">
              ← Вернуться в работу с договорами
            </Link>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="contract-page">
      <div className="contract-layout">
        <aside className="contract-side">
          <div className="contract-side__top">
            <Link className="ghost-btn ghost-btn--inline" href="/">
              ← Назад
            </Link>
            <button className="primary" disabled={!canOpenClientIterationModal} onClick={openIterationModal} type="button">
              + Запрос клиента
            </button>
          </div>

          <h2 className="contract-side__title">Вход клиента</h2>
          <div className="input-list">
            {clientIterations.length === 0 ? (
              <div className="iteration-empty">
                Пока нет запросов от клиента. Добавьте первый запрос, чтобы сформировать протокол разногласий.
              </div>
            ) : (
              clientIterations.map((iteration) => {
                const isActive = selectedIterationId === iteration.id;
                const attachmentCount = iteration.attachments?.length ?? 0;
                return (
                  <button
                    className={`iteration-item ${isActive ? "active" : ""}`}
                    key={iteration.id}
                    onClick={() => {
                      setSelectedIterationId(iteration.id);
                      setActiveDocTab("protocol");
                    }}
                    type="button"
                  >
                    <span className="iteration-item__name">Запрос клиента</span>
                    <span className="iteration-item__meta">
                      {formatDate(iteration.updatedAt)} • файлов: {attachmentCount}
                    </span>
                  </button>
                );
              })
            )}
          </div>

        </aside>

        <section className="contract-main">
          <header className="contract-main__header">
            <div>
              <h1>{contract.templateName}</h1>
              <p className="muted-text">Кейс договора: вход клиента → протокол разногласий → согласованная редакция.</p>
            </div>
          </header>

          <div className="contract-editor-column">
            <div className="contract-editor-wrap">
              <div className="doc-tabs">
                <button
                  className={`doc-tab ${activeDocTab === "template" ? "active" : ""}`}
                  onClick={() => setActiveDocTab("template")}
                  type="button"
                >
                  Шаблон договора
                </button>
                <button
                  className={`doc-tab ${activeDocTab === "protocol" ? "active" : ""}`}
                  onClick={() => setActiveDocTab("protocol")}
                  type="button"
                >
                  Протокол разногласий
                </button>
                <button
                  className={`doc-tab ${activeDocTab === "agreed" ? "active" : ""}`}
                  onClick={() => setActiveDocTab("agreed")}
                  type="button"
                >
                  Согласованная редакция
                </button>
              </div>

              {selectedClientIteration ? (
                <div className="case-context">
                  <span>Вход клиента: {formatDate(selectedClientIteration.updatedAt)}</span>
                  <span>
                    {selectedClientIteration.requestText
                      ? `Описание: ${selectedClientIteration.requestText}`
                      : "Описание: см. вложения"}
                  </span>
                </div>
              ) : (
                <div className="case-context">
                  <span>Пока нет входов от клиента.</span>
                </div>
              )}

              <div className="iteration-viewer-wrap">
                {activeDocumentSource ? (
                  <>
                    <OnlyOfficeViewer
                      key={`${activeDocumentSource.fileUrl}:${activeDocumentSource.fileName}`}
                      fileName={activeDocumentSource.fileName}
                      fileUrl={activeDocumentSource.fileUrl}
                    />
                    {isProtocolUpdating ? (
                      <div className="iteration-viewer-overlay">
                        <span>Обновляем документ...</span>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="iteration-viewer-placeholder">
                    {activeDocTab === "protocol" ? (
                      <p className="muted-text">
                        Протокол разногласий появится после обработки входа клиента.
                        {protocolError ? ` Ошибка: ${protocolError}` : ""}
                      </p>
                    ) : activeDocTab === "agreed" ? (
                      <p className="muted-text">Согласованная редакция будет создана после ответа юриста.</p>
                    ) : (
                      <p className="muted-text">Шаблон договора не найден.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <aside className="contract-ai">
          <div className="contract-ai__head">
            <h3>Сводка и ответы</h3>
            <span className="integration-status warn">Черновик</span>
          </div>
          <p className="muted-text">
            Здесь сводка и комментарии ИИ. Дайте ответ по каждому пункту и сформируйте согласованную редакцию.
          </p>
          {selectedClientIteration?.kind === "client-request" ? (
            <>
              {isAiAnalyzing ? <p className="loading-text">Анализируем изменения клиента...</p> : null}
              {aiError ? <p className="form-error">{aiError}</p> : null}
              {isProtocolUpdating ? <p className="muted-text">Формируем ответ...</p> : null}

              {selectedClientIteration.aiAnalysis ? (
                <div className="contract-ai__list">
                  <div className="contract-ai__item">
                    <strong>Сводка:</strong> {selectedClientIteration.aiAnalysis.summary}
                  </div>
                  <div className="contract-ai__item">
                    <strong>Рекомендация:</strong> {selectedClientIteration.aiAnalysis.recommendation}
                  </div>
                  {selectedClientIteration.aiAnalysis.items.map((item) => (
                    <div className="contract-ai__item" key={item.id}>
                      <div>
                        <strong>Раздел:</strong> {item.section}
                      </div>
                      <div>
                        <strong>Серьезность:</strong> {item.severity}
                      </div>
                      <div>
                        <strong>Было:</strong> {item.was || "-"}
                      </div>
                      <div>
                        <strong>Стало:</strong> {item.now || "-"}
                      </div>
                      <div>
                        <strong>Комментарий ИИ:</strong> {item.aiComment || "-"}
                      </div>
                      <label className="field ai-response-input">
                        <span>Наш ответ</span>
                        <textarea
                          onChange={(event) => updateAiItemResponse(item.id, event.target.value)}
                          placeholder="Ответ по этому пункту"
                          rows={3}
                          value={aiItemResponses[item.id] ?? ""}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="contract-ai__list">
                  <div className="contract-ai__item">
                    После запуска анализа здесь появятся комментарии ИИ в формате проверки правок.
                  </div>
                </div>
              )}
              {responseError ? <p className="form-error">{responseError}</p> : null}
              {responseGenerationError ? <p className="form-error">{responseGenerationError}</p> : null}
              <p className="muted-text">Черновик ответов сохраняется автоматически.</p>
              <button
                className="primary"
                disabled={!selectedClientIteration.aiAnalysis || selectedClientIteration.aiAnalysis.items.length === 0}
                onClick={createCompanyResponseIteration}
                type="button"
              >
                Сформировать редакцию
              </button>
            </>
          ) : (
            <div className="contract-ai__list">
              <div className="contract-ai__item">
                Выберите вход клиента, чтобы увидеть анализ и дать ответ.
              </div>
            </div>
          )}
        </aside>
      </div>

      {isIterationModalOpen ? (
        <div className="modal-root" aria-label="Новая клиентская итерация" aria-modal="true" role="dialog">
          <div className="modal-backdrop" onClick={closeIterationModal} />
          <div className="modal-card">
            <h3>Правки клиента</h3>
            <div className="client-form">
              <p className="muted-text">
                Опишите правки текстом, приложите файл или оба варианта. Это создаст четную итерацию клиента.
              </p>
              <label className="field">
                <span>Описание правок</span>
                <textarea
                  onChange={(event) => setRequestText(event.target.value)}
                  placeholder="Что хочет изменить клиент"
                  rows={5}
                  value={requestText}
                />
              </label>

              <label className="field">
                <span>Приложить файл</span>
                <input
                  multiple
                  onChange={(event) => {
                    void handleAttachmentSelect(event.target.files);
                    event.currentTarget.value = "";
                  }}
                  type="file"
                />
              </label>

              {isUploading ? <p className="muted-text">Загружаем файлы...</p> : null}

              {attachments.length > 0 ? (
                <div className="iteration-attachment-list">
                  {attachments.map((item) => (
                    <div className="iteration-attachment-item iteration-attachment-item--row" key={item.id}>
                      <span>
                        {item.fileName} • {formatFileSize(item.fileSize)}
                      </span>
                      <button
                        className="ghost-btn ghost-btn--inline"
                        onClick={() => removeAttachment(item.id)}
                        type="button"
                      >
                        Удалить
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {iterationModalError ? <p className="form-error">{iterationModalError}</p> : null}

            <div className="modal-actions">
              <button className="ghost-btn" onClick={closeIterationModal} type="button">
                Отмена
              </button>
              <button className="primary" disabled={isUploading || isAiAnalyzing} onClick={() => void createClientRequestIteration()} type="button">
                {isUploading ? "Загружаем..." : isAiAnalyzing ? "Обрабатываем..." : "Обработать"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </main>
  );
}
