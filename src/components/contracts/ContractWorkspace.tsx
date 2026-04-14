"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { ContractDraft, ProtocolInputMode, ProtocolRow } from "@/lib/contracts/types";
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

const aiModeOptions = [
  { id: "client-points" as ProtocolInputMode, labelKey: "workspace.contract.branch.points.title", descKey: "workspace.contract.branch.points.desc", inputKind: "text" as const },
  { id: "client-freeform" as ProtocolInputMode, labelKey: "workspace.contract.branch.freeform.title", descKey: "workspace.contract.branch.freeform.desc", inputKind: "text" as const },
  { id: "client-protocol" as ProtocolInputMode, labelKey: "workspace.contract.branch.clientProtocol.title", descKey: "workspace.contract.branch.clientProtocol.desc", inputKind: "file" as const },
  { id: "edited-template" as ProtocolInputMode, labelKey: "workspace.contract.branch.editedTemplate.title", descKey: "workspace.contract.branch.editedTemplate.desc", inputKind: "file" as const },
  { id: "protocol-sync" as ProtocolInputMode, labelKey: "workspace.contract.branch.protocolSync.title", descKey: "workspace.contract.branch.protocolSync.desc", inputKind: "file" as const },
] as const;

const scope = {
  tenantId: process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID ?? "local-tenant",
  agentId: process.env.NEXT_PUBLIC_PLATFORM_AGENT_ID ?? "jurist3-agent",
};

function getLocale(): Locale {
  return "ru";
}

function getModeLabelKey(mode: ProtocolInputMode): `workspace.${string}` {
  switch (mode) {
    case "client-freeform": return "workspace.contract.branch.freeform.title";
    case "client-points": return "workspace.contract.branch.points.title";
    case "client-protocol": return "workspace.contract.branch.clientProtocol.title";
    case "edited-template": return "workspace.contract.branch.editedTemplate.title";
    case "protocol-sync": return "workspace.contract.branch.protocolSync.title";
    default: return "workspace.contract.branch.points.title";
  }
}

export function ContractWorkspace() {
  const params = useParams();
  const contractId = typeof params?.contractId === "string" ? params.contractId : "";
  const locale = getLocale();
  
  const [activeTab, setActiveTab] = useState<TabId>("template");
  const [showFinalize, setShowFinalize] = useState(false);
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
  
  const chatFileRef = useRef<HTMLInputElement | null>(null);
  
  const [protocolRowsState, setProtocolRowsState] = useState<ProtocolRow[]>([]);
  const [editCell, setEditCell] = useState<{ row: number; field: keyof ProtocolRow } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [protocolEditError, setProtocolEditError] = useState<string | null>(null);
  const [protocolEditSaving, setProtocolEditSaving] = useState(false);

  const isFinalTab = activeTab === "final";
  const currentMode = aiModeOptions.find((item) => item.id === inputMode) ?? aiModeOptions[0];
  const modeNeedsText = currentMode.inputKind === "text";
  const modeNeedsFile = currentMode.inputKind === "file";

  const loadData = useCallback(async () => {
    const headers = { "x-tenant-id": scope.tenantId, "x-agent-id": scope.agentId };
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
  }, [contractId, locale]);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => { setProtocolRowsState(Array.isArray(contract?.protocolRows) ? contract.protocolRows : []); }, [contract?.protocolRows]);
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
  const protocolComments = Array.isArray(contract?.protocolComments) ? contract.protocolComments : [];
  const protocolRequests = Array.isArray(contract?.protocolRequests) ? [...contract.protocolRequests].reverse() : [];

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

  const submitDisabled = isFinalTab || aiSubmitting || (modeNeedsText ? !message.trim() : !pendingFile);

  return (
    <main className="contract-workspace">
      <section className="contract-workspace__left">
        <header className="contract-workspace__header">
          <div><span className="eyebrow">{t(locale, "workspace.contract.label")}</span><h1>{t(locale, "workspace.contract.title")}</h1></div>
          <button className="primary" onClick={() => setShowFinalize(true)}>{t(locale, "workspace.contract.action.finalize")}</button>
        </header>
        <div className="contract-workspace__back"><a className="ghost-btn ghost-btn--inline" href="/">{t(locale, "workspace.contract.action.back")}</a></div>
        <div className="contract-tabs">
          {tabOptions.map((tab) => (<button key={tab.id} type="button" className={`contract-tab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>{t(locale, tab.labelKey as any)}</button>))}
        </div>
        <div className="contract-view">
          <div className="contract-view__hint">
            {activeTab === "template" && t(locale, "workspace.contract.view.template")}
            {activeTab === "protocol" && t(locale, "workspace.contract.view.protocol")}
            {activeTab === "final" && t(locale, "workspace.contract.view.final")}
          </div>
          <div className="contract-view__frame">
            {loadError && <p className="form-error">{loadError}</p>}
            {activeTab === "template" && (templateFileUrl ? <OnlyOfficeViewer fileUrl={templateFileUrl} fileName={templateFileName} mode="view" /> : <div className="contract-view__placeholder"><h3>{t(locale, "workspace.contract.empty.title")}</h3><p className="muted-text">{t(locale, "workspace.contract.empty.template")}</p></div>)}
            {activeTab === "protocol" && (
              <div className="contract-protocol-panel">
                {!protocolFileUrl ? <div className="contract-protocol-empty"><p className="muted-text">{t(locale, "workspace.contract.protocol.empty")}</p></div> : <OnlyOfficeViewer fileUrl={protocolFileUrl} fileName={protocolFileName} mode="edit" />}
                {protocolRowsState.length > 0 && (
                  <>
                    <div className="protocol-actions"><a className="ghost-btn ghost-btn--inline" href={`/api/contracts/protocol-download?contractId=${encodeURIComponent(contractId)}`}>{t(locale, "workspace.contract.protocol.download")}</a></div>
                    <div className="protocol-table-wrap"><h4>{t(locale, "workspace.contract.protocol.table.title")}</h4>
                      <div className="protocol-table">
                        <div className="protocol-table__head"><span>{t(locale, "workspace.contract.protocol.table.clause")}</span><span>{t(locale, "workspace.contract.protocol.table.client")}</span><span>{t(locale, "workspace.contract.protocol.table.our")}</span><span>{t(locale, "workspace.contract.protocol.table.agreed")}</span></div>
                        {protocolRowsState.map((row, index) => {
                          const isClauseEdit = editCell?.row === index && editCell.field === "clause";
                          const isClientEdit = editCell?.row === index && editCell.field === "clientText";
                          const isOurEdit = editCell?.row === index && editCell.field === "ourText";
                          const isAgreedEdit = editCell?.row === index && editCell.field === "agreedText";
                          return (<div className="protocol-table__row" key={`${row.clause}-${index}`}>
                            <div className="protocol-cell">{isClauseEdit ? <div className="protocol-cell__edit"><input value={editValue} onChange={(e) => setEditValue(e.target.value)} /><div className="protocol-cell__actions"><button disabled={protocolEditSaving} onClick={() => saveEdit(index, "clause")}>💾</button><button onClick={() => setEditCell(null)}>✖</button></div></div> : <div className="protocol-cell__view"><span>{row.clause || "-"}</span><button onClick={() => { setEditCell({ row: index, field: "clause" }); setEditValue(row.clause || ""); }}>✎</button></div>}</div>
                            <div className="protocol-cell">{isClientEdit ? <div className="protocol-cell__edit"><textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} /><div className="protocol-cell__actions"><button disabled={protocolEditSaving} onClick={() => saveEdit(index, "clientText")}>💾</button><button onClick={() => setEditCell(null)}>✖</button></div></div> : <div className="protocol-cell__view"><span>{row.clientText || "-"}</span><button onClick={() => { setEditCell({ row: index, field: "clientText" }); setEditValue(row.clientText || ""); }}>✎</button></div>}</div>
                            <div className="protocol-cell">{isOurEdit ? <div className="protocol-cell__edit"><textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} /><div className="protocol-cell__actions"><button disabled={protocolEditSaving} onClick={() => saveEdit(index, "ourText")}>💾</button><button onClick={() => setEditCell(null)}>✖</button></div></div> : <div className="protocol-cell__view"><span>{row.ourText || "-"}</span><button onClick={() => { setEditCell({ row: index, field: "ourText" }); setEditValue(row.ourText || ""); }}>✎</button></div>}</div>
                            <div className="protocol-cell">{isAgreedEdit ? <div className="protocol-cell__edit"><textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} /><div className="protocol-cell__actions"><button disabled={protocolEditSaving} onClick={() => saveEdit(index, "agreedText")}>💾</button><button onClick={() => setEditCell(null)}>✖</button></div></div> : <div className="protocol-cell__view"><span>{row.agreedText || "-"}</span><button onClick={() => { setEditCell({ row: index, field: "agreedText" }); setEditValue(row.agreedText || ""); }}>✎</button></div>}</div>
                          </div>);
                        })}
                      </div>
                    </div>
                  </>
                )}
                {protocolEditError && <p className="form-error">{protocolEditError}</p>}
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="contract-workspace__right">
        <div className="contract-ai-panel">
          <div className="contract-ai-panel__header"><h2>{t(locale, "workspace.contract.ai.title")}</h2><span className={`status ${isFinalTab ? "warn" : "ok"}`}>{isFinalTab ? t(locale, "workspace.contract.ai.status.view") : t(locale, "workspace.contract.ai.status.active")}</span></div>
          <p className="muted-text">{t(locale, "workspace.contract.ai.helper")}</p>
          {contract?.protocolSummary && (<div className="contract-ai-summary"><h3>{t(locale, "workspace.contract.ai.summary.title")}</h3><p>{contract.protocolSummary}</p>{contract.protocolRecommendation && <p>{contract.protocolRecommendation}</p>}</div>)}
          {protocolComments.length > 0 && (<div className="contract-ai-comments"><h3>{t(locale, "workspace.contract.ai.comments.title")}</h3>{protocolComments.map((item) => (<div key={item.id} className={`contract-ai-comment severity-${item.severity}`}><div><strong>{item.clause}</strong><span>{item.severity}</span></div><p>Было: {item.was}</p><p>Стало: {item.now}</p><p>{item.comment}</p>{item.guidance && <p>{item.guidance}</p>}</div>))}</div>)}
          
          <div className="contract-ai-request">
            <div><h3>{t(locale, "workspace.contract.ai.request.title")}</h3><p className="muted-text">{t(locale, "workspace.contract.ai.request.subtitle")}</p></div>
            <div><h3>{t(locale, "workspace.contract.ai.mode.title")}</h3>{aiModeOptions.map((option) => (<button key={option.id} type="button" className={`contract-ai-branch ${inputMode === option.id ? "active" : ""}`} onClick={() => setInputMode(option.id)} disabled={isFinalTab}><strong>{t(locale, option.labelKey as any)}</strong><span>{t(locale, option.descKey as any)}</span></button>))}</div>
            {modeNeedsText && (
  <div className="contract-ai-input">
    <label htmlFor="ai-message">{t(locale, "workspace.contract.ai.input")}</label>
    <textarea
      id="ai-message"
      value={message}
      onChange={(e) => setMessage(e.target.value)}
      placeholder={
        inputMode === "client-freeform"
          ? "Опишите запрос клиента..."
          : "Вставьте пункты клиента..."
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
        📎 Прикрепить
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
          Удалить
        </button>
      </div>
    )}
  </div>
)}
            <button className="primary" disabled={submitDisabled} onClick={handleAiSubmit}>{t(locale, "workspace.contract.ai.send")}</button>
            {aiError && <p className="form-error">{aiError}</p>}{aiNotice && <p className="muted-text">{aiNotice}</p>}
          </div>

          <div className="contract-ai-log"><h3>{t(locale, "workspace.contract.ai.log.title")}</h3>{protocolRequests.length === 0 ? <p className="muted-text">{t(locale, "workspace.contract.ai.log.empty")}</p> : protocolRequests.map((item) => (<div key={item.id}><div><strong>{t(locale, getModeLabelKey(item.mode))}</strong><span>{new Date(item.createdAt).toLocaleString()}</span></div>{item.fileName && <div>📄 {item.fileName}</div>}{item.summary && <p>{item.summary}</p>}<p>{item.text}</p></div>))}</div>
        </div>
      </aside>
    </main>
  );
}