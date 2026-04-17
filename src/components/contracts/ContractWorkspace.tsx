"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type {
  ContractDraft,
  ProtocolColumnTitles,
  ProtocolInputMode,
  ProtocolRow,
} from "@/lib/contracts/types";
import { OnlyOfficeViewer } from "@/components/contracts/OnlyOfficeViewer";
import { t } from "@/i18n";
import type { Locale } from "@/i18n/types";
import type { KnowledgeDocument } from "@/lib/knowledge/types";
import { usePublicConfig } from "@/lib/usePublicConfig";

const tabOptions = [
  { id: "template", labelKey: "workspace.contract.tab.template" },
  { id: "protocol", labelKey: "workspace.contract.tab.protocol" },
  { id: "final", labelKey: "workspace.contract.tab.final" },
] as const;

type TabId = (typeof tabOptions)[number]["id"];
type AiPanelSection = "review" | "request" | "context";

const aiModeOptions = [
  { id: "client-points" as ProtocolInputMode, labelKey: "workspace.contract.branch.points.title", descKey: "workspace.contract.branch.points.desc", inputKind: "text" as const },
  { id: "client-freeform" as ProtocolInputMode, labelKey: "workspace.contract.branch.freeform.title", descKey: "workspace.contract.branch.freeform.desc", inputKind: "text" as const },
  { id: "client-protocol" as ProtocolInputMode, labelKey: "workspace.contract.branch.clientProtocol.title", descKey: "workspace.contract.branch.clientProtocol.desc", inputKind: "file" as const },
  { id: "edited-template" as ProtocolInputMode, labelKey: "workspace.contract.branch.editedTemplate.title", descKey: "workspace.contract.branch.editedTemplate.desc", inputKind: "file" as const },
  { id: "commented-template" as ProtocolInputMode, labelKey: "workspace.contract.branch.commentedTemplate.title", descKey: "workspace.contract.branch.commentedTemplate.desc", inputKind: "file" as const },
  { id: "protocol-sync" as ProtocolInputMode, labelKey: "workspace.contract.branch.protocolSync.title", descKey: "workspace.contract.branch.protocolSync.desc", inputKind: "file" as const },
] as const;

function getAiSectionLabel(id: AiPanelSection): string {
  if (id === "request") return "Запрос";
  if (id === "review") return "Комментарии";
  return "Контекст";
}

function getLocale(): Locale {
  return "ru";
}

function getDefaultProtocolColumnTitles(locale: Locale): ProtocolColumnTitles {
  return {
    client: t(locale, "workspace.contract.protocol.table.client"),
    our: t(locale, "workspace.contract.protocol.table.our"),
    agreed: t(locale, "workspace.contract.protocol.table.agreed"),
  };
}

function getModeLabelKey(mode: ProtocolInputMode): `workspace.${string}` {
  switch (mode) {
    case "client-freeform": return "workspace.contract.branch.freeform.title";
    case "client-points": return "workspace.contract.branch.points.title";
    case "client-protocol": return "workspace.contract.branch.clientProtocol.title";
    case "edited-template": return "workspace.contract.branch.editedTemplate.title";
    case "commented-template": return "workspace.contract.branch.commentedTemplate.title";
    case "protocol-sync": return "workspace.contract.branch.protocolSync.title";
    default: return "workspace.contract.branch.points.title";
  }
}

export function ContractWorkspace() {
  const { config: publicConfig } = usePublicConfig();
  const tenantId = publicConfig?.platformTenantId ?? "local-tenant";
  const agentId = publicConfig?.platformAgentId ?? "jurist3-agent";

  const params = useParams();
  const contractId = typeof params?.contractId === "string" ? params.contractId : "";
  const locale = getLocale();
  
  const [activeTab, setActiveTab] = useState<TabId>("template");
  const [showFinalize, setShowFinalize] = useState(false);
  const [finalizeBusy, setFinalizeBusy] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<ProtocolInputMode>("client-points");
  const [message, setMessage] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [contract, setContract] = useState<ContractDraft | null>(null);
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDocument[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // const [templateCheck, setTemplateCheck] = useState<string | null>(null);
  const [aiSubmitting, setAiSubmitting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [activeAiSection, setActiveAiSection] = useState<AiPanelSection>("request");
  
  const chatFileRef = useRef<HTMLInputElement | null>(null);
  const aiSectionScrollRef = useRef<HTMLDivElement | null>(null);
  
  const [protocolRowsState, setProtocolRowsState] = useState<ProtocolRow[]>([]);
  const [editCell, setEditCell] = useState<{ row: number; field: keyof ProtocolRow } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [protocolEditError, setProtocolEditError] = useState<string | null>(null);
  const [protocolEditSaving, setProtocolEditSaving] = useState(false);
  const [columnTitlesEditing, setColumnTitlesEditing] = useState(false);
  const [columnTitlesSaving, setColumnTitlesSaving] = useState(false);
  const [columnTitlesError, setColumnTitlesError] = useState<string | null>(null);
  const [columnTitlesDraft, setColumnTitlesDraft] = useState<ProtocolColumnTitles>(
    getDefaultProtocolColumnTitles(locale),
  );

  const isFinalTab = activeTab === "final";
  const currentMode = aiModeOptions.find((item) => item.id === inputMode) ?? aiModeOptions[0];
  const modeNeedsText = currentMode.inputKind === "text";
  const modeNeedsFile = currentMode.inputKind === "file";

  const loadData = useCallback(async () => {
    const headers = { "x-tenant-id": tenantId, "x-agent-id": agentId };
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
      const knowledgePayload = (await knowledgeRes.json().catch(() => null)) as { items?: KnowledgeDocument[] } | null;
      const match = payload?.items?.find((item) => item.id === contractId) ?? null;
      setContract(match ?? null);
      if (Array.isArray(knowledgePayload?.items)) setKnowledgeDocs(knowledgePayload.items);
    } catch {
      setLoadError(t(locale, "workspace.contract.error.load"));
    }
  }, [agentId, contractId, locale, tenantId]);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => { setProtocolRowsState(Array.isArray(contract?.protocolRows) ? contract.protocolRows : []); }, [contract?.protocolRows]);
  useEffect(() => {
    const defaults = getDefaultProtocolColumnTitles(locale);
    const fromContract = contract?.protocolColumnTitles;
    if (!fromContract) {
      setColumnTitlesDraft(defaults);
      return;
    }
    setColumnTitlesDraft({
      client: String(fromContract.client || defaults.client),
      our: String(fromContract.our || defaults.our),
      agreed: String(fromContract.agreed || defaults.agreed),
    });
  }, [contract?.protocolColumnTitles, locale]);
  useEffect(() => {
    setAiError(null); setAiNotice(null);
    if (modeNeedsText) setPendingFile(null);
    else setMessage("");
  }, [inputMode, modeNeedsText]);

  const templateDocs = knowledgeDocs.filter((doc) => doc.section === "templates" && doc.fileUrl);
  const fallbackTemplate = knowledgeDocs.find((doc) => doc.id === contract?.templateDocId);
  const fallbackByName = !fallbackTemplate && contract?.templateName ? knowledgeDocs.find((doc) => doc.fileName === contract.templateName) : null;
  const fallbackSingle = !fallbackTemplate && !fallbackByName && templateDocs.length === 1 ? templateDocs[0] : null;
  const directTemplateUrl = contract?.templateDocId ? `/api/knowledge/files/${contract.templateDocId}` : "";
  const templateFileUrl = contract?.templateFileUrl ?? fallbackTemplate?.fileUrl ?? fallbackByName?.fileUrl ?? fallbackSingle?.fileUrl ?? directTemplateUrl;
  const templateFileName = contract?.templateName ?? fallbackTemplate?.fileName ?? fallbackByName?.fileName ?? fallbackSingle?.fileName ?? undefined;
  const protocolFileUrl = contract?.protocolFileUrl ?? "";
  const protocolFileName = contract?.protocolFileName ?? undefined;
  const finalFileUrl = contract?.finalFileUrl ?? "";
  const finalFileName = contract?.finalFileName ?? undefined;
  const protocolComments = Array.isArray(contract?.protocolComments) ? contract.protocolComments : [];
  const protocolRequests = Array.isArray(contract?.protocolRequests) ? [...contract.protocolRequests].reverse() : [];
  const prevAiSection: AiPanelSection | null =
    activeAiSection === "review" ? "request" : activeAiSection === "context" ? "review" : null;
  const nextAiSection: AiPanelSection | null =
    activeAiSection === "request" ? "review" : activeAiSection === "review" ? "context" : null;

  const handleAiSubmit = async () => {
    if (!contractId) return;
    if (modeNeedsText && !message.trim()) return;
    if (modeNeedsFile && !pendingFile) return;
    setAiSubmitting(true); setAiError(null); setAiNotice(null);
    try {
      const formData = new FormData();
      formData.append("contractId", contractId);
      formData.append("mode", inputMode);
      if (message.trim()) formData.append("message", message.trim());
      if (pendingFile) formData.append("file", pendingFile);
      const response = await fetch("/api/contracts/analyze-protocol", { method: "POST", body: formData });
      if (!response.ok) { setAiError(t(locale, "workspace.contract.ai.error")); return; }
      await loadData();
      setAiNotice(t(locale, "workspace.contract.ai.notice.protocol"));
      setMessage(""); setPendingFile(null);
    } catch { setAiError(t(locale, "workspace.contract.ai.error")); }
    finally { setAiSubmitting(false); }
  };

  const saveEdit = async (rowIndex: number, field: keyof ProtocolRow) => {
    if (!contractId) return;
    const next = protocolRowsState.map((row, index) => index === rowIndex ? { ...row, [field]: editValue } : row);
    setProtocolRowsState(next);
    setProtocolEditSaving(true); setProtocolEditError(null);
    try {
      const response = await fetch("/api/contracts/update-protocol-rows", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, rows: next }),
      });
      if (!response.ok) throw new Error();
      await loadData();
      setEditCell(null); setEditValue("");
    } catch { setProtocolEditError(t(locale, "workspace.contract.protocol.edit.error")); }
    finally { setProtocolEditSaving(false); }
  };

  const saveColumnTitles = async () => {
    if (!contractId) return;
    setColumnTitlesSaving(true);
    setColumnTitlesError(null);
    try {
      const response = await fetch("/api/contracts/update-protocol-columns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, titles: columnTitlesDraft }),
      });
      if (!response.ok) throw new Error();
      await loadData();
      setColumnTitlesEditing(false);
    } catch {
      setColumnTitlesError("Не удалось сохранить заголовки колонок.");
    } finally {
      setColumnTitlesSaving(false);
    }
  };

  const isFinalized = contract?.status === "finalized";
  const submitDisabled = isFinalTab || isFinalized || aiSubmitting || (modeNeedsText ? !message.trim() : !pendingFile);

  useEffect(() => {
    if (isFinalized) {
      setActiveTab("final");
    }
  }, [isFinalized]);

  useEffect(() => {
    aiSectionScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeAiSection]);

  const finalizeContract = async () => {
    if (!contractId) return;
    setFinalizeBusy(true);
    setFinalizeError(null);
    try {
      const response = await fetch("/api/contracts/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId }),
      });
      if (!response.ok) {
        throw new Error();
      }
      await loadData();
      setActiveTab("final");
      setShowFinalize(false);
    } catch {
      setFinalizeError("Не удалось завершить договор.");
    } finally {
      setFinalizeBusy(false);
    }
  };

  return (
    <main className="contract-workspace">
      <section className="contract-workspace__left">
        <header className="contract-workspace__header">
          <div><span className="eyebrow">{t(locale, "workspace.contract.label")}</span><h1>{t(locale, "workspace.contract.title")}</h1></div>
          {!isFinalized ? (
            <button className="primary" onClick={() => setShowFinalize(true)}>{t(locale, "workspace.contract.action.finalize")}</button>
          ) : (
            <span className="status ok">Договор завершен</span>
          )}
        </header>
        <div className="contract-workspace__toolbar">
          <div className="contract-workspace__back"><Link className="ghost-btn ghost-btn--inline" href="/">{t(locale, "workspace.contract.action.back")}</Link></div>
          <div className="contract-tabs">
            {(isFinalized ? tabOptions.filter((tab) => tab.id === "final") : tabOptions).map((tab) => (
              <button key={tab.id} type="button" className={`contract-tab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
                {t(locale, tab.labelKey as never)}
              </button>
            ))}
          </div>
        </div>
        <div className={`contract-view contract-view--${activeTab}`}>
          <div className="contract-view__hint">
            {activeTab === "template" && t(locale, "workspace.contract.view.template")}
            {activeTab === "protocol" && t(locale, "workspace.contract.view.protocol")}
            {activeTab === "final" && t(locale, "workspace.contract.view.final")}
            {activeTab === "protocol" && protocolRowsState.length > 0 && (
              <a className="ghost-btn ghost-btn--inline protocol-download-btn" href={`/api/contracts/protocol-download?contractId=${encodeURIComponent(contractId)}`}>
                {t(locale, "workspace.contract.protocol.download")}
              </a>
            )}
          </div>
          <div className={`contract-view__frame contract-view__frame--${activeTab}`}>
            {loadError && <p className="form-error">{loadError}</p>}
            {activeTab === "template" && (isFinalized ? (
              <div className="contract-view__placeholder">
                <h3>Шаблон закрыт после завершения</h3>
                <p className="muted-text">Доступен только финальный документ.</p>
              </div>
            ) : templateFileUrl ? <OnlyOfficeViewer fileUrl={templateFileUrl} fileName={templateFileName} mode="view" /> : <div className="contract-view__placeholder"><h3>{t(locale, "workspace.contract.empty.title")}</h3><p className="muted-text">{t(locale, "workspace.contract.empty.template")}</p></div>)}
            {activeTab === "protocol" && (
              <div className="contract-protocol-panel">
                {isFinalized ? (
                  <div className="contract-protocol-empty">
                    <p className="muted-text">Протокол закрыт после завершения договора.</p>
                  </div>
                ) : protocolFileUrl ? (
                  <OnlyOfficeViewer fileUrl={protocolFileUrl} fileName={protocolFileName} mode="edit" />
                ) : null}
                {protocolRowsState.length > 0 && (
                  <>
                    <div className="protocol-table-wrap"><h4>{t(locale, "workspace.contract.protocol.table.title")}</h4>
                      <div className="protocol-table">
                        <div className="protocol-table__toolbar">
                          <div className="protocol-table__toolbar-title">
                            <span className="muted-text">Шапка таблицы</span>
                          </div>
                          <div className="protocol-table__toolbar-actions">
                            {!columnTitlesEditing ? (
                              <button
                                className="ghost-btn ghost-btn--inline"
                                type="button"
                                onClick={() => {
                                  setColumnTitlesEditing(true);
                                  setColumnTitlesError(null);
                                }}
                              >
                                Редактировать
                              </button>
                            ) : (
                              <>
                                <button
                                  className="primary"
                                  type="button"
                                  onClick={saveColumnTitles}
                                  disabled={columnTitlesSaving}
                                >
                                  Сохранить
                                </button>
                                <button
                                  className="ghost-btn ghost-btn--inline"
                                  type="button"
                                  onClick={() => {
                                    setColumnTitlesEditing(false);
                                    setColumnTitlesError(null);
                                    const defaults = getDefaultProtocolColumnTitles(locale);
                                    const fromContract = contract?.protocolColumnTitles;
                                    setColumnTitlesDraft({
                                      client: String(fromContract?.client || defaults.client),
                                      our: String(fromContract?.our || defaults.our),
                                      agreed: String(fromContract?.agreed || defaults.agreed),
                                    });
                                  }}
                                >
                                  Отмена
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {columnTitlesEditing && (
                          <div className="protocol-table__titles">
                            <label className="protocol-title-field">
                              <span className="muted-text">Колонка 1</span>
                              <input
                                className="protocol-title-input"
                                value={columnTitlesDraft.client}
                                onChange={(e) =>
                                  setColumnTitlesDraft((prev) => ({
                                    ...prev,
                                    client: e.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label className="protocol-title-field">
                              <span className="muted-text">Колонка 2</span>
                              <input
                                className="protocol-title-input"
                                value={columnTitlesDraft.our}
                                onChange={(e) =>
                                  setColumnTitlesDraft((prev) => ({
                                    ...prev,
                                    our: e.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label className="protocol-title-field">
                              <span className="muted-text">Колонка 3</span>
                              <input
                                className="protocol-title-input"
                                value={columnTitlesDraft.agreed}
                                onChange={(e) =>
                                  setColumnTitlesDraft((prev) => ({
                                    ...prev,
                                    agreed: e.target.value,
                                  }))
                                }
                              />
                            </label>
                            {columnTitlesError && (
                              <p className="form-error">{columnTitlesError}</p>
                            )}
                          </div>
                        )}

                        <div className="protocol-table__head">
                          <span>{t(locale, "workspace.contract.protocol.table.clause")}</span>
                          <span>{columnTitlesDraft.client}</span>
                          <span>{columnTitlesDraft.our}</span>
                          <span>{columnTitlesDraft.agreed}</span>
                        </div>
                        {protocolRowsState.map((row, index) => {
                          const isClauseEdit = editCell?.row === index && editCell.field === "clause";
                          const isClientEdit = editCell?.row === index && editCell.field === "clientText";
                          const isOurEdit = editCell?.row === index && editCell.field === "ourText";
                          const isAgreedEdit = editCell?.row === index && editCell.field === "agreedText";
                          return (<div className="protocol-table__row" key={`${row.clause}-${index}`}>
                            <div className="protocol-cell">{isClauseEdit ? <div className="protocol-cell__edit"><input className="protocol-cell__input" value={editValue} onChange={(e) => setEditValue(e.target.value)} /><div className="protocol-cell__actions"><button className="protocol-cell__btn protocol-cell__btn--save" disabled={protocolEditSaving} onClick={() => saveEdit(index, "clause")}>Save</button><button className="protocol-cell__btn" onClick={() => { setEditCell(null); setEditValue(""); }}>Cancel</button></div></div> : <div className="protocol-cell__view"><span className="protocol-cell__text">{row.clause || "-"}</span><button className="protocol-cell__btn" onClick={() => { setEditCell({ row: index, field: "clause" }); setEditValue(row.clause || ""); }}>Edit</button></div>}</div>
                            <div className="protocol-cell">{isClientEdit ? <div className="protocol-cell__edit"><textarea className="protocol-cell__textarea" value={editValue} onChange={(e) => setEditValue(e.target.value)} /><div className="protocol-cell__actions"><button className="protocol-cell__btn protocol-cell__btn--save" disabled={protocolEditSaving} onClick={() => saveEdit(index, "clientText")}>Save</button><button className="protocol-cell__btn" onClick={() => { setEditCell(null); setEditValue(""); }}>Cancel</button></div></div> : <div className="protocol-cell__view"><span className="protocol-cell__text">{row.clientText || "-"}</span><button className="protocol-cell__btn" onClick={() => { setEditCell({ row: index, field: "clientText" }); setEditValue(row.clientText || ""); }}>Edit</button></div>}</div>
                            <div className="protocol-cell">{isOurEdit ? <div className="protocol-cell__edit"><textarea className="protocol-cell__textarea" value={editValue} onChange={(e) => setEditValue(e.target.value)} /><div className="protocol-cell__actions"><button className="protocol-cell__btn protocol-cell__btn--save" disabled={protocolEditSaving} onClick={() => saveEdit(index, "ourText")}>Save</button><button className="protocol-cell__btn" onClick={() => { setEditCell(null); setEditValue(""); }}>Cancel</button></div></div> : <div className="protocol-cell__view"><span className="protocol-cell__text">{row.ourText || "-"}</span><button className="protocol-cell__btn" onClick={() => { setEditCell({ row: index, field: "ourText" }); setEditValue(row.ourText || ""); }}>Edit</button></div>}</div>
                            <div className="protocol-cell">{isAgreedEdit ? <div className="protocol-cell__edit"><textarea className="protocol-cell__textarea" value={editValue} onChange={(e) => setEditValue(e.target.value)} /><div className="protocol-cell__actions"><button className="protocol-cell__btn protocol-cell__btn--save" disabled={protocolEditSaving} onClick={() => saveEdit(index, "agreedText")}>Save</button><button className="protocol-cell__btn" onClick={() => { setEditCell(null); setEditValue(""); }}>Cancel</button></div></div> : <div className="protocol-cell__view"><span className="protocol-cell__text">{row.agreedText || "-"}</span><button className="protocol-cell__btn" onClick={() => { setEditCell({ row: index, field: "agreedText" }); setEditValue(row.agreedText || ""); }}>Edit</button></div>}</div>
                          </div>);
                        })}
                      </div>
                    </div>
                  </>
                )}
                {protocolEditError && <p className="form-error">{protocolEditError}</p>}
              </div>
            )}
            {activeTab === "final" && (
              <div className="contract-final-panel">
                {finalFileUrl ? (
                  <>
                    <div className="protocol-actions">
                      <a className="ghost-btn ghost-btn--inline" href={finalFileUrl} download>
                        Скачать финальный документ
                      </a>
                    </div>
                    <OnlyOfficeViewer fileUrl={finalFileUrl} fileName={finalFileName} mode="view" />
                  </>
                ) : (
                  <div className="contract-view__placeholder">
                    <h3>Финальный документ еще не сформирован</h3>
                    <p className="muted-text">Нажмите «Завершить», чтобы сформировать итоговый документ.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="contract-workspace__right">
        <div className="contract-ai-panel">
          <div className="contract-ai-panel__header"><h2>{t(locale, "workspace.contract.ai.title")}</h2><span className={`status ${aiSubmitting || isFinalTab ? "warn" : "ok"}`}>{aiSubmitting ? "Processing..." : isFinalTab ? t(locale, "workspace.contract.ai.status.view") : t(locale, "workspace.contract.ai.status.active")}</span></div>
          <p className="muted-text contract-ai-panel__helper">{t(locale, "workspace.contract.ai.helper")}</p>

          <div className="contract-ai-panel__edge contract-ai-panel__edge--top">
            <button
              type="button"
              className={`contract-ai-panel__next contract-ai-panel__next--top ${prevAiSection ? "visible" : ""}`}
              onClick={() => prevAiSection && setActiveAiSection(prevAiSection)}
              disabled={!prevAiSection}
            >
              ▲ {prevAiSection ? getAiSectionLabel(prevAiSection) : ""}
            </button>
          </div>

          <div className="contract-ai-panel__content" ref={aiSectionScrollRef}>
            {activeAiSection === "review" && (
              <section className="contract-ai-panel__section contract-ai-panel__section--enter">
                {contract?.protocolSummary && (<div className="contract-ai-summary"><h3>{t(locale, "workspace.contract.ai.summary.title")}</h3><p>{contract.protocolSummary}</p>{contract.protocolRecommendation && <p>{contract.protocolRecommendation}</p>}</div>)}
                {protocolComments.length > 0 && (<div className="contract-ai-comments"><h3>{t(locale, "workspace.contract.ai.comments.title")}</h3>{protocolComments.map((item) => (<div key={item.id} className={`contract-ai-comment severity-${item.severity}`}><div><strong>{item.clause}</strong><span>{item.severity}</span></div><p>Was: {item.was}</p><p>Now: {item.now}</p><p>{item.comment}</p>{item.guidance && <p>{item.guidance}</p>}</div>))}</div>)}
                {!contract?.protocolSummary && protocolComments.length === 0 ? (
                  <p className="muted-text contract-ai-panel__empty">No AI comments yet. Send a request in the Request section.</p>
                ) : null}
              </section>
            )}

            {activeAiSection === "request" && (
              <section className="contract-ai-panel__section contract-ai-panel__section--enter">
                <div className="contract-ai-request">
                  <div><h3>{t(locale, "workspace.contract.ai.request.title")}</h3><p className="muted-text">{t(locale, "workspace.contract.ai.request.subtitle")}</p></div>
                  <div><h3>{t(locale, "workspace.contract.ai.mode.title")}</h3>{aiModeOptions.map((option) => (<button key={option.id} type="button" className={`contract-ai-branch ${inputMode === option.id ? "active" : ""}`} onClick={() => setInputMode(option.id)} disabled={isFinalTab}><strong>{t(locale, option.labelKey as never)}</strong><span>{t(locale, option.descKey as never)}</span></button>))}</div>
                  {modeNeedsText && (
            <div className="contract-ai-input">
              <label htmlFor="ai-message">{t(locale, "workspace.contract.ai.input")}</label>
              <textarea
                id="ai-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={
                  inputMode === "client-freeform"
                    ? "Describe the client request..."
                    : "Paste client points..."
                }
              />
            </div>
          )}
                  {modeNeedsFile && (
            <div className="contract-ai-input">
              <label>{t(locale, "workspace.contract.ai.fileLabel")}</label>

              <div className="contract-ai-actions">
                <button
                  className="ghost-btn ghost-btn--inline"
                  type="button"
                  disabled={isFinalTab}
                  onClick={() => chatFileRef.current?.click()}
                >
                  Attach file
                </button>

                <input
                  ref={chatFileRef}
                  className="hidden-file-input"
                  type="file"
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0] ?? null;
                    e.currentTarget.value = "";
                    if (file) {
                      setPendingFile(file);
                    }
                  }}
                />
              </div>

              {pendingFile && (
                <div className="contract-ai-attachment">
                  <span className="muted-text">{pendingFile.name}</span>
                  <button
                    className="ghost-btn ghost-btn--inline"
                    type="button"
                    onClick={() => setPendingFile(null)}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          )}
                  {aiSubmitting ? (
                    <div className="contract-ai-processing" role="status" aria-live="polite">
                      <div className="contract-ai-processing__spinner" aria-hidden="true" />
                      <div className="contract-ai-processing__text">
                        <strong>AI is analyzing your request</strong>
                        <span>Building summary, comments and protocol updates...</span>
                      </div>
                      <div className="contract-ai-processing__dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  ) : null}
                  <button className="primary" disabled={submitDisabled} onClick={handleAiSubmit}>{t(locale, "workspace.contract.ai.send")}</button>
                  {aiError && <p className="form-error">{aiError}</p>}{aiNotice && <p className="muted-text">{aiNotice}</p>}
                </div>
              </section>
            )}

            {activeAiSection === "context" && (
              <section className="contract-ai-panel__section contract-ai-panel__section--enter">
                <div className="contract-ai-log"><h3>{t(locale, "workspace.contract.ai.log.title")}</h3>{protocolRequests.length === 0 ? <p className="muted-text">{t(locale, "workspace.contract.ai.log.empty")}</p> : protocolRequests.map((item) => (<div key={item.id}><div><strong>{t(locale, getModeLabelKey(item.mode))}</strong><span>{new Date(item.createdAt).toLocaleString()}</span></div>{item.fileName && <div>File: {item.fileName}</div>}{item.summary && <p>{item.summary}</p>}<p>{item.text}</p></div>))}</div>
              </section>
            )}
          </div>

          <div className="contract-ai-panel__edge visible">
            <button
              type="button"
              className={`contract-ai-panel__next contract-ai-panel__next--bottom ${nextAiSection ? "flag" : ""}`}
              onClick={() => nextAiSection && setActiveAiSection(nextAiSection)}
              disabled={!nextAiSection}
            >
              v {nextAiSection ? getAiSectionLabel(nextAiSection) : ""}
            </button>
          </div>
        </div>
      </aside>

      {showFinalize ? (
        <div className="modal-root" role="dialog" aria-modal="true" aria-label="Завершение договора">
          <div className="modal-backdrop" onClick={() => setShowFinalize(false)} />
          <div className="modal-card">
            <h3>Завершить работу над договором?</h3>
            <p className="muted-text">
              После завершения будут доступны только финальные документы. Шаблон и протокол
              станут недоступны для просмотра и редактирования.
            </p>
            {finalizeError && <p className="form-error">{finalizeError}</p>}
            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => setShowFinalize(false)} type="button">
                Отмена
              </button>
              <button className="primary" onClick={finalizeContract} disabled={finalizeBusy} type="button">
                Завершить
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
