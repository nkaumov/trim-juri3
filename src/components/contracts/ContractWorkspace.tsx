"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { ContractDraft, ProtocolRow } from "@/lib/contracts/types";
import { OnlyOfficeViewer } from "@/components/contracts/OnlyOfficeViewer";
import { t } from "@/i18n";
import type { Locale } from "@/i18n/types";
import type { KnowledgeDocument } from "@/lib/knowledge/types";

const tabOptions = [
  { id: "template", labelKey: "workspace.contract.tab.template" },
  { id: "protocol", labelKey: "workspace.contract.tab.protocol" },
  { id: "final", labelKey: "workspace.contract.tab.final" },
] as const;

type TabId = (typeof tabOptions)[number]["id"];

const scope = {
  tenantId: process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID ?? "local-tenant",
  agentId: process.env.NEXT_PUBLIC_PLATFORM_AGENT_ID ?? "jurist3-agent",
};

function getLocale(): Locale {
  return "ru";
}

export function ContractWorkspace() {
  const params = useParams();
  const contractId = typeof params?.contractId === "string" ? params.contractId : "";
  const locale = getLocale();
  const [activeTab, setActiveTab] = useState<TabId>("template");
  const [showFinalize, setShowFinalize] = useState(false);
  const [message, setMessage] = useState("");
  const [contract, setContract] = useState<ContractDraft | null>(null);
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDocument[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templateCheck, setTemplateCheck] = useState<string | null>(null);
  const [aiSubmitting, setAiSubmitting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const chatFileRef = useRef<HTMLInputElement | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [protocolRowsState, setProtocolRowsState] = useState<ProtocolRow[]>([]);
  const [editCell, setEditCell] = useState<{ row: number; field: keyof ProtocolRow } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [protocolEditError, setProtocolEditError] = useState<string | null>(null);
  const [protocolEditSaving, setProtocolEditSaving] = useState(false);

  const isProtocolTab = activeTab === "protocol";
  const isFinalTab = activeTab === "final";

  const hint = useMemo(() => t(locale, "workspace.contract.ai.helper"), [locale]);

  const loadData = useCallback(async () => {
    const headers = {
      "x-tenant-id": scope.tenantId,
      "x-agent-id": scope.agentId,
    };
    if (!contractId) return;
    setLoadError(null);
    try {
      const [contractsRes, knowledgeRes] = await Promise.all([
        fetch("/api/storage/contracts", { headers }),
        fetch("/api/storage/knowledge", { headers }),
      ]);
      if (contractsRes.status === 401 || knowledgeRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!contractsRes.ok) {
        setLoadError(t(locale, "workspace.contract.error.load"));
        return;
      }
      const payload = (await contractsRes.json().catch(() => null)) as { items?: ContractDraft[] } | null;
      const knowledgePayload = (await knowledgeRes.json().catch(() => null)) as
        | { items?: KnowledgeDocument[] }
        | null;
      const match = payload?.items?.find((item) => item.id === contractId) ?? null;
      setContract(match ?? null);
      if (Array.isArray(knowledgePayload?.items)) {
        setKnowledgeDocs(knowledgePayload.items);
      }
    } catch {
      setLoadError(t(locale, "workspace.contract.error.load"));
    }
  }, [contractId, locale]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const rows = Array.isArray(contract?.protocolRows) ? contract.protocolRows : [];
    setProtocolRowsState(rows);
  }, [contract?.protocolRows]);

  const templateDocs = knowledgeDocs.filter((doc) => doc.section === "templates" && doc.fileUrl);
  const fallbackTemplate = knowledgeDocs.find((doc) => doc.id === contract?.templateDocId);
  const fallbackByName =
    !fallbackTemplate && contract?.templateName
      ? knowledgeDocs.find((doc) => doc.fileName === contract.templateName)
      : null;
  const fallbackSingle = !fallbackTemplate && !fallbackByName && templateDocs.length === 1 ? templateDocs[0] : null;
  const directTemplateUrl = contract?.templateDocId
    ? `/api/knowledge/files/${contract.templateDocId}`
    : "";
  const templateFileUrl =
    contract?.templateFileUrl ??
    fallbackTemplate?.fileUrl ??
    fallbackByName?.fileUrl ??
    fallbackSingle?.fileUrl ??
    directTemplateUrl;
  const templateFileName =
    contract?.templateName ??
    fallbackTemplate?.fileName ??
    fallbackByName?.fileName ??
    fallbackSingle?.fileName ??
    undefined;
  const protocolFileUrl = contract?.protocolFileUrl ?? "";
  const protocolFileName = contract?.protocolFileName ?? undefined;
  const protocolComments = Array.isArray(contract?.protocolComments) ? contract?.protocolComments : [];
  const hasProtocolRows = Array.isArray(contract?.protocolRows) && contract.protocolRows.length > 0;

  const templateDebug = useMemo(
    () => ({
      contractId: contract?.id ?? "",
      templateDocId: contract?.templateDocId ?? "",
      templateName: contract?.templateName ?? "",
      resolvedUrl: templateFileUrl,
      matchById: Boolean(fallbackTemplate?.fileUrl),
      matchByName: Boolean(fallbackByName?.fileUrl),
    }),
    [contract, fallbackByName, fallbackTemplate, templateFileUrl],
  );

  async function checkTemplateAvailability() {
    if (!templateFileUrl) {
      setTemplateCheck(t(locale, "workspace.contract.template.check.empty"));
      return;
    }
    try {
      const response = await fetch(templateFileUrl, { method: "HEAD", cache: "no-store" });
      if (response.ok) {
        setTemplateCheck(t(locale, "workspace.contract.template.check.ok"));
      } else {
        setTemplateCheck(
          t(locale, "workspace.contract.template.check.fail").replace(
            "{status}",
            String(response.status),
          ),
        );
      }
    } catch {
      setTemplateCheck(t(locale, "workspace.contract.template.check.error"));
    }
  }

  async function handleAiSubmit() {
    if (!contractId || (!message.trim() && !pendingFile)) return;
    setAiSubmitting(true);
    setAiError(null);
    setAiNotice(null);
    try {
      const formData = new FormData();
      formData.append("contractId", contractId);
      if (message.trim()) {
        formData.append("message", message.trim());
      }
      if (pendingFile) {
        formData.append("file", pendingFile);
      }
      const response = await fetch("/api/contracts/analyze-protocol", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        setAiError(t(locale, "workspace.contract.ai.error"));
        return;
      }
      await loadData();
      setAiNotice(t(locale, "workspace.contract.ai.notice.protocol"));
      setMessage("");
      setPendingFile(null);
    } catch {
      setAiError(t(locale, "workspace.contract.ai.error"));
    } finally {
      setAiSubmitting(false);
    }
  }

  function startEdit(rowIndex: number, field: keyof ProtocolRow, value: string) {
    setEditCell({ row: rowIndex, field });
    setEditValue(value);
    setProtocolEditError(null);
  }

  function cancelEdit() {
    setEditCell(null);
    setEditValue("");
  }

  async function saveEdit(rowIndex: number, field: keyof ProtocolRow) {
    if (!contractId) return;
    const previous = protocolRowsState;
    const next = protocolRowsState.map((row, index) =>
      index === rowIndex ? { ...row, [field]: editValue } : row,
    );
    setProtocolRowsState(next);
    setProtocolEditSaving(true);
    setProtocolEditError(null);
    try {
      const response = await fetch("/api/contracts/update-protocol-rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, rows: next }),
      });
      if (!response.ok) {
        setProtocolRowsState(previous);
        setProtocolEditError(t(locale, "workspace.contract.protocol.edit.error"));
        return;
      }
      await loadData();
      setEditCell(null);
      setEditValue("");
    } catch {
      setProtocolRowsState(previous);
      setProtocolEditError(t(locale, "workspace.contract.protocol.edit.error"));
    } finally {
      setProtocolEditSaving(false);
    }
  }

  return (
    <main className="contract-workspace">
      <section className="contract-workspace__left">
        <header className="contract-workspace__header">
          <div>
            <span className="eyebrow">{t(locale, "workspace.contract.label")}</span>
            <h1>{t(locale, "workspace.contract.title")}</h1>
          </div>
          <button
            className="primary"
            type="button"
            onClick={() => setShowFinalize(true)}
          >
            {t(locale, "workspace.contract.action.finalize")}
          </button>
        </header>
        <div className="contract-workspace__back">
          <a className="ghost-btn ghost-btn--inline" href="/">
            {t(locale, "workspace.contract.action.back")}
          </a>
        </div>

        <div className="contract-tabs">
          {tabOptions.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`contract-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {t(locale, tab.labelKey as `workspace.${string}`)}
            </button>
          ))}
        </div>

        <div className="contract-view">
          <div className="contract-view__hint">
            {activeTab === "template" && t(locale, "workspace.contract.view.template")}
            {activeTab === "protocol" && t(locale, "workspace.contract.view.protocol")}
            {activeTab === "final" && t(locale, "workspace.contract.view.final")}
          </div>
          <div className="contract-view__frame">
            {loadError ? <p className="form-error">{loadError}</p> : null}
            {activeTab === "template" ? (
              templateFileUrl ? (
                <OnlyOfficeViewer fileUrl={templateFileUrl} fileName={templateFileName} mode="view" />
              ) : (
                <div className="contract-view__placeholder">
                  <h3>{t(locale, "workspace.contract.empty.title")}</h3>
                  <p className="muted-text">{t(locale, "workspace.contract.empty.template")}</p>
                </div>
              )
            ) : null}
            {activeTab === "protocol" ? (
              <div className="contract-protocol-panel">
                {!protocolFileUrl ? (
                  <div className="contract-protocol-empty">
                    <p className="muted-text">{t(locale, "workspace.contract.protocol.empty")}</p>
                  </div>
                ) : (
                  <OnlyOfficeViewer fileUrl={protocolFileUrl} fileName={protocolFileName} mode="edit" />
                )}
                {hasProtocolRows ? (
                  <div className="protocol-actions">
                    <a
                      className="ghost-btn ghost-btn--inline"
                      href={`/api/contracts/protocol-download?contractId=${encodeURIComponent(contractId)}`}
                    >
                      {t(locale, "workspace.contract.protocol.download")}
                    </a>
                  </div>
                ) : null}
                {protocolRowsState.length ? (
                  <div className="protocol-table-wrap">
                    <h4>{t(locale, "workspace.contract.protocol.table.title")}</h4>
                    <div className="protocol-table">
                      <div className="protocol-table__head">
                        <span>{t(locale, "workspace.contract.protocol.table.clause")}</span>
                        <span>{t(locale, "workspace.contract.protocol.table.client")}</span>
                        <span>{t(locale, "workspace.contract.protocol.table.our")}</span>
                        <span>{t(locale, "workspace.contract.protocol.table.agreed")}</span>
                      </div>
                      {protocolRowsState.map((row, index) => {
                        const isClauseEdit = editCell?.row === index && editCell.field === "clause";
                        const isClientEdit = editCell?.row === index && editCell.field === "clientText";
                        const isOurEdit = editCell?.row === index && editCell.field === "ourText";
                        const isAgreedEdit = editCell?.row === index && editCell.field === "agreedText";
                        return (
                        <div className="protocol-table__row" key={`${row.clause}-${index}`}>
                          <div className="protocol-cell">
                            {isClauseEdit ? (
                              <div className="protocol-cell__edit">
                                <input
                                  className="protocol-cell__input"
                                  value={editValue}
                                  onChange={(event) => setEditValue(event.target.value)}
                                />
                                <div className="protocol-cell__actions">
                                  <button
                                    className="ghost-btn ghost-btn--inline"
                                    type="button"
                                    disabled={protocolEditSaving}
                                    onClick={() => saveEdit(index, "clause")}
                                  >
                                    {t(locale, "workspace.contract.protocol.cell.save")}
                                  </button>
                                  <button
                                    className="ghost-btn ghost-btn--inline"
                                    type="button"
                                    onClick={cancelEdit}
                                  >
                                    {t(locale, "workspace.contract.protocol.cell.cancel")}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="protocol-cell__view">
                                <span>{row.clause || "-"}</span>
                                <button
                                  className="ghost-btn ghost-btn--inline"
                                  type="button"
                                  onClick={() => startEdit(index, "clause", row.clause || "")}
                                >
                                  {t(locale, "workspace.contract.protocol.cell.edit")}
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="protocol-cell">
                            {isClientEdit ? (
                              <div className="protocol-cell__edit">
                                <textarea
                                  className="protocol-cell__textarea"
                                  value={editValue}
                                  onChange={(event) => setEditValue(event.target.value)}
                                />
                                <div className="protocol-cell__actions">
                                  <button
                                    className="ghost-btn ghost-btn--inline"
                                    type="button"
                                    disabled={protocolEditSaving}
                                    onClick={() => saveEdit(index, "clientText")}
                                  >
                                    {t(locale, "workspace.contract.protocol.cell.save")}
                                  </button>
                                  <button
                                    className="ghost-btn ghost-btn--inline"
                                    type="button"
                                    onClick={cancelEdit}
                                  >
                                    {t(locale, "workspace.contract.protocol.cell.cancel")}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="protocol-cell__view">
                                <span>{row.clientText || "-"}</span>
                                <button
                                  className="ghost-btn ghost-btn--inline"
                                  type="button"
                                  onClick={() => startEdit(index, "clientText", row.clientText || "")}
                                >
                                  {t(locale, "workspace.contract.protocol.cell.edit")}
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="protocol-cell">
                            {isOurEdit ? (
                              <div className="protocol-cell__edit">
                                <textarea
                                  className="protocol-cell__textarea"
                                  value={editValue}
                                  onChange={(event) => setEditValue(event.target.value)}
                                />
                                <div className="protocol-cell__actions">
                                  <button
                                    className="ghost-btn ghost-btn--inline"
                                    type="button"
                                    disabled={protocolEditSaving}
                                    onClick={() => saveEdit(index, "ourText")}
                                  >
                                    {t(locale, "workspace.contract.protocol.cell.save")}
                                  </button>
                                  <button
                                    className="ghost-btn ghost-btn--inline"
                                    type="button"
                                    onClick={cancelEdit}
                                  >
                                    {t(locale, "workspace.contract.protocol.cell.cancel")}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="protocol-cell__view">
                                <span>{row.ourText || "-"}</span>
                                <button
                                  className="ghost-btn ghost-btn--inline"
                                  type="button"
                                  onClick={() => startEdit(index, "ourText", row.ourText || "")}
                                >
                                  {t(locale, "workspace.contract.protocol.cell.edit")}
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="protocol-cell">
                            {isAgreedEdit ? (
                              <div className="protocol-cell__edit">
                                <textarea
                                  className="protocol-cell__textarea"
                                  value={editValue}
                                  onChange={(event) => setEditValue(event.target.value)}
                                />
                                <div className="protocol-cell__actions">
                                  <button
                                    className="ghost-btn ghost-btn--inline"
                                    type="button"
                                    disabled={protocolEditSaving}
                                    onClick={() => saveEdit(index, "agreedText")}
                                  >
                                    {t(locale, "workspace.contract.protocol.cell.save")}
                                  </button>
                                  <button
                                    className="ghost-btn ghost-btn--inline"
                                    type="button"
                                    onClick={cancelEdit}
                                  >
                                    {t(locale, "workspace.contract.protocol.cell.cancel")}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="protocol-cell__view">
                                <span>{row.agreedText || "-"}</span>
                                <button
                                  className="ghost-btn ghost-btn--inline"
                                  type="button"
                                  onClick={() => startEdit(index, "agreedText", row.agreedText || "")}
                                >
                                  {t(locale, "workspace.contract.protocol.cell.edit")}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {protocolEditError ? <p className="form-error">{protocolEditError}</p> : null}
                {aiSubmitting ? (
                  <p className="muted-text">{t(locale, "workspace.contract.ai.processing")}</p>
                ) : null}
                {aiError ? <p className="form-error">{aiError}</p> : null}
              </div>
            ) : null}
            {activeTab === "template" ? (
              <div className="contract-template-debug">
                <div className="template-debug-actions">
                  <button className="ghost-btn ghost-btn--inline" type="button" onClick={checkTemplateAvailability}>
                    {t(locale, "workspace.contract.template.check.button")}
                  </button>
                  {templateFileUrl ? (
                    <a className="ghost-btn ghost-btn--inline" href={templateFileUrl} target="_blank" rel="noreferrer">
                      {t(locale, "workspace.contract.template.check.open")}
                    </a>
                  ) : null}
                </div>
                {templateCheck ? (
                  <p className="muted-text">{templateCheck}</p>
                ) : null}
                <div className="template-debug-grid">
                  <div>
                    <span className="muted-text">{t(locale, "workspace.contract.template.debug.contractId")}</span>
                        <strong>{templateDebug.contractId || "--"}</strong>
                  </div>
                  <div>
                    <span className="muted-text">{t(locale, "workspace.contract.template.debug.templateDocId")}</span>
                        <strong>{templateDebug.templateDocId || "--"}</strong>
                  </div>
                  <div>
                    <span className="muted-text">{t(locale, "workspace.contract.template.debug.templateName")}</span>
                        <strong>{templateDebug.templateName || "--"}</strong>
                  </div>
                  <div>
                    <span className="muted-text">{t(locale, "workspace.contract.template.debug.resolvedUrl")}</span>
                        <strong>{templateDebug.resolvedUrl || "--"}</strong>
                  </div>
                  <div>
                    <span className="muted-text">{t(locale, "workspace.contract.template.debug.matchId")}</span>
                    <strong>{templateDebug.matchById ? "yes" : "no"}</strong>
                  </div>
                  <div>
                    <span className="muted-text">{t(locale, "workspace.contract.template.debug.matchName")}</span>
                    <strong>{templateDebug.matchByName ? "yes" : "no"}</strong>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <aside className="contract-workspace__right">
        <div className="contract-ai-panel">
          <div className="contract-ai-panel__header">
            <h2>{t(locale, "workspace.contract.ai.title")}</h2>
            <span className={`status ${isFinalTab ? "warn" : "ok"}`}>
              {isFinalTab
                ? t(locale, "workspace.contract.ai.status.view")
                : t(locale, "workspace.contract.ai.status.active")}
            </span>
          </div>
          <p className="muted-text">{hint}</p>
          {contract?.protocolSummary ? (
            <div className="contract-ai-summary">
              <h3>{t(locale, "workspace.contract.ai.summary.title")}</h3>
              <p className="muted-text">{contract.protocolSummary}</p>
              {contract.protocolRecommendation ? (
                <p className="muted-text">{contract.protocolRecommendation}</p>
              ) : null}
            </div>
          ) : null}
          {protocolComments.length > 0 ? (
            <div className="contract-ai-comments">
              <h3>{t(locale, "workspace.contract.ai.comments.title")}</h3>
              <div className="contract-ai-comments__list">
                {protocolComments.map((item) => (
                  <div className={`contract-ai-comment severity-${item.severity}`} key={item.id}>
                    <div className="contract-ai-comment__head">
                      <strong>{item.clause || "-"}</strong>
                      <span>{t(locale, `workspace.contract.ai.comments.severity.${item.severity}`)}</span>
                    </div>
                    <p className="muted-text">
                      {t(locale, "workspace.contract.ai.comments.was")} {item.was}
                    </p>
                    <p className="muted-text">
                      {t(locale, "workspace.contract.ai.comments.now")} {item.now}
                    </p>
                    <p>{item.comment}</p>
                    {item.guidance ? <p className="muted-text">{item.guidance}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="contract-ai-input">
            <label htmlFor="ai-message">{t(locale, "workspace.contract.ai.input")}</label>
            <textarea
              id="ai-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={t(locale, "workspace.contract.ai.placeholder")}
            />
            <div className="contract-ai-actions">
              <button
                className="ghost-btn ghost-btn--inline"
                type="button"
                onClick={() => chatFileRef.current?.click()}
              >
                {t(locale, "workspace.contract.ai.attach")}
              </button>
              <input
                ref={chatFileRef}
                className="hidden-file-input"
                type="file"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] ?? null;
                  event.currentTarget.value = "";
                  if (file) {
                    setPendingFile(file);
                  }
                }}
              />
              <button
                className="primary"
                type="button"
                disabled={(!message.trim() && !pendingFile) || aiSubmitting}
                onClick={handleAiSubmit}
              >
                {t(locale, "workspace.contract.ai.send")}
              </button>
            </div>
            {aiError ? <p className="form-error">{aiError}</p> : null}
            {aiNotice ? <p className="muted-text">{aiNotice}</p> : null}
            {pendingFile ? (
              <div className="contract-ai-attachment">
                <span className="muted-text">
                  {t(locale, "workspace.contract.ai.attachment.label").replace("{name}", pendingFile.name)}
                </span>
                <button
                  className="ghost-btn ghost-btn--inline"
                  type="button"
                  onClick={() => setPendingFile(null)}
                >
                  {t(locale, "workspace.contract.ai.attachment.clear")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      {showFinalize ? (
        <div className="modal-root">
          <div className="modal-backdrop" onClick={() => setShowFinalize(false)} />
          <div className="modal-card">
            <h3>{t(locale, "workspace.contract.finalize.title")}</h3>
            <p className="muted-text">{t(locale, "workspace.contract.finalize.text")}</p>
            <div className="modal-actions">
              <button className="ghost-btn" type="button" onClick={() => setShowFinalize(false)}>
                {t(locale, "workspace.contract.finalize.cancel")}
              </button>
              <button className="primary" type="button">
                {t(locale, "workspace.contract.finalize.confirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
