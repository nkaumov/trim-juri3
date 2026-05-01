"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ContractDraft, ContractPlatformState, ProtocolComment, ProtocolRow } from "@/lib/contracts/types";
import type { KnowledgeDocument } from "@/lib/knowledge/types";
import { usePublicConfig } from "@/lib/usePublicConfig";
import { randomUUID } from "@/lib/random-uuid";

type MainTab = "protocol" | "comments" | "template";
type InputKind = "text" | "file";

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
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function severityBadge(value: ProtocolComment["severity"]): string {
  if (value === "critical") return "критично";
  if (value === "moderate") return "средне";
  return "низко";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

type PlatformOutputProtocolRow = {
  clause?: unknown;
  client_text?: unknown;
  clientText?: unknown;
  our_text?: unknown;
  ourText?: unknown;
};

type PlatformOutputItem = {
  id?: unknown;
  clause?: unknown;
  severity?: unknown;
  was?: unknown;
  now?: unknown;
  comment?: unknown;
  aiComment?: unknown;
  basis?: unknown;
  guidance?: unknown;
};

function mapOutputToRows(output: Record<string, unknown>): ProtocolRow[] {
  const rows = asArray(output["protocol_rows"]) as unknown[];
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

function mapOutputToComments(output: Record<string, unknown>): ProtocolComment[] {
  const items = asArray(output["items"]) as unknown[];
  const mapped: ProtocolComment[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as PlatformOutputItem;
    const severityRaw = asString(item.severity).trim();
    const severity: ProtocolComment["severity"] =
      severityRaw === "critical" || severityRaw === "moderate" || severityRaw === "minor"
        ? (severityRaw as ProtocolComment["severity"])
        : "moderate";

    mapped.push({
      id: asString(item.id).trim() || randomUUID(),
      clause: asString(item.clause).trim() || "\u2014",
      was: asString(item.was),
      now: asString(item.now),
      severity,
      comment: asString(item.comment ?? item.aiComment).trim() || "Комментарий не указан.",
      guidance: asString(item.basis ?? item.guidance).trim() || undefined,
    });
  }
  return mapped;
}

export function ContractWorkspace() {
  const { config: publicConfig } = usePublicConfig();
  const tenantId = publicConfig?.platformTenantId ?? "local-tenant";
  const agentId = publicConfig?.platformAgentId ?? "jurist3-agent";

  const params = useParams();
  const contractId = typeof params?.contractId === "string" ? params.contractId : "";

  const [contract, setContract] = useState<ContractDraft | null>(null);
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDocument[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const states = useMemo(
    () => (Array.isArray(contract?.platformStates) ? contract!.platformStates! : []),
    [contract?.platformStates],
  );

  const [activeStateId, setActiveStateId] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("protocol");

  const [protocolDraft, setProtocolDraft] = useState<Array<{ clause: string; clientText: string; ourText: string }>>(
    [],
  );
  const [protocolSaveBusy, setProtocolSaveBusy] = useState(false);
  const [protocolSaveError, setProtocolSaveError] = useState<string | null>(null);

  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateText, setTemplateText] = useState<string | null>(null);
  const [templateRules, setTemplateRules] = useState<string | null>(null);

  const [isInputModalOpen, setIsInputModalOpen] = useState(false);
  const [inputKind, setInputKind] = useState<InputKind>("text");
  const [inputText, setInputText] = useState("");
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [inputFileKey, setInputFileKey] = useState(0);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [showFinalize, setShowFinalize] = useState(false);
  const [finalizeBusy, setFinalizeBusy] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!contractId) return;
    const headers = { "x-tenant-id": tenantId, "x-agent-id": agentId };
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
      const payload = (await contractsRes.json().catch(() => null)) as { items?: ContractDraft[] } | null;
      const knowledgePayload = (await knowledgeRes.json().catch(() => null)) as { items?: KnowledgeDocument[] } | null;
      const match = payload?.items?.find((item) => item.id === contractId) ?? null;
      setContract(match);
      if (Array.isArray(knowledgePayload?.items)) setKnowledgeDocs(knowledgePayload.items);

      const states = Array.isArray(match?.platformStates) ? match!.platformStates! : [];
      if (!activeStateId && states.length > 0) {
        setActiveStateId(states[0].id);
      }
    } catch {
      setLoadError("Не удалось загрузить данные дела.");
    }
  }, [activeStateId, agentId, contractId, tenantId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeState = useMemo(
    () => (activeStateId ? states.find((s) => s.id === activeStateId) ?? null : null),
    [activeStateId, states],
  );

  useEffect(() => {
    if (!activeState) {
      setProtocolDraft([]);
      return;
    }
    const rows = Array.isArray(activeState.protocolRows) ? activeState.protocolRows : [];
    setProtocolDraft(
      rows.map((r) => ({
        clause: String(r.clause || ""),
        clientText: String(r.clientText || ""),
        ourText: String(r.ourText || ""),
      })),
    );
    setProtocolSaveError(null);
  }, [activeState]);

  const templateDocs = knowledgeDocs.filter((doc) => doc.section === "templates" && doc.fileUrl);
  const fallbackTemplate = knowledgeDocs.find((doc) => doc.id === contract?.templateDocId);
  const fallbackByName =
    !fallbackTemplate && contract?.templateName
      ? knowledgeDocs.find((doc) => doc.fileName === contract.templateName)
      : null;
  const fallbackSingle = !fallbackTemplate && !fallbackByName && templateDocs.length === 1 ? templateDocs[0] : null;
  const directTemplateUrl = contract?.templateDocId ? `/api/knowledge/files/${contract.templateDocId}` : "";
  const templateFileUrl =
    contract?.templateFileUrl ?? fallbackTemplate?.fileUrl ?? fallbackByName?.fileUrl ?? fallbackSingle?.fileUrl ?? directTemplateUrl;

  const isFinalized = contract?.status === "finalized";

  const canSend =
    !sendBusy &&
    !isFinalized &&
    (inputKind === "text" ? Boolean(inputText.trim()) : Boolean(inputFile));

  function openInput(kind: InputKind) {
    if (isFinalized) return;
    setInputKind(kind);
    setInputText("");
    setInputFile(null);
    setInputFileKey((v) => v + 1);
    setSendError(null);
    setIsInputModalOpen(true);
  }

  async function loadTemplate() {
    if (!contractId || templateBusy) return;
    if (templateText) return;
    setTemplateBusy(true);
    setTemplateError(null);
    try {
      const res = await fetch(`/api/contracts/template-text?contractId=${encodeURIComponent(contractId)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setTemplateError("Не удалось получить текст шаблона.");
        setTemplateBusy(false);
        return;
      }
      const payload = (await res.json().catch(() => null)) as unknown;
      const template = asRecord(asRecord(payload)["template"]);
      setTemplateText(asString(template["text"]));
      setTemplateRules(asString(template["rules"]));
    } catch {
      setTemplateError("Не удалось получить текст шаблона.");
    } finally {
      setTemplateBusy(false);
    }
  }

  async function sendToPlatformContract(event: FormEvent) {
    event.preventDefault();
    if (!contractId) return;
    if (!canSend) return;

    const messageToSend = inputKind === "text" ? inputText.trim() : "";
    const fileToSend = inputKind === "file" ? inputFile : null;

    setSendBusy(true);
    setSendError(null);
    try {
      const formData = new FormData();
      formData.append("contractId", contractId);
      if (inputKind === "text") {
        formData.append("message", messageToSend);
      } else if (fileToSend) {
        formData.append("file", fileToSend);
      }

      setIsInputModalOpen(false);

      const response = await fetch("/api/platform/debug-input", { method: "POST", body: formData });
      const payload = (await response.json().catch(() => null)) as
        | { platformOutput?: unknown; platformError?: unknown; error?: unknown; ok?: unknown }
        | null;
      if (!response.ok) {
        const message =
          (payload?.platformError ? String(payload.platformError) : "") ||
          (payload?.error ? String(payload.error) : "") ||
          "Не удалось получить ответ от платформы.";
        setSendError(message);
        setSendBusy(false);
        return;
      }
      if (!payload) {
        setSendError("Пустой ответ от сервера.");
        setSendBusy(false);
        return;
      }

      if (payload.platformError) {
        setSendError(String(payload.platformError));
        setSendBusy(false);
        return;
      }
      if (!payload.platformOutput || typeof payload.platformOutput !== "object") {
        setSendError("Ответ платформы не распознан как JSON. Проверьте prompt агента.");
        setSendBusy(false);
        return;
      }

      const output = payload.platformOutput as Record<string, unknown>;
      const rows = mapOutputToRows(output);
      const comments = mapOutputToComments(output);
      const summary = asString(output["summary"]).trim();
      const recommendation = asString(output["recommendation"]).trim();

      const state: ContractPlatformState = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        task: "protocol_draft",
        inputMode: "client-freeform",
        userMessage: messageToSend,
        fileName: fileToSend ? fileToSend.name : undefined,
        fileType: fileToSend ? fileToSend.type : undefined,
        protocolRows: rows,
        protocolComments: comments,
        summary: summary || (rows.length ? `Обновлено: ${rows.length} строк(и) протокола.` : "Ответ получен."),
        recommendation: recommendation || undefined,
        platformOutput: output,
      };

      const saveRes = await fetch("/api/contracts/add-platform-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, state }),
      });
      if (!saveRes.ok) {
        setSendError("Не удалось сохранить состояние.");
        setSendBusy(false);
        return;
      }

      setActiveStateId(state.id);
      setMainTab("protocol");

      setInputText("");
      setInputFile(null);
      setInputFileKey((v) => v + 1);
      await loadData();
    } catch {
      setSendError("Не удалось отправить запрос на платформу.");
    } finally {
      setSendBusy(false);
    }
  }

  async function saveProtocolDraft() {
    if (!contractId || !activeStateId) return;
    if (isFinalized) return;
    setProtocolSaveBusy(true);
    setProtocolSaveError(null);
    try {
      const patchRows: ProtocolRow[] = protocolDraft
        .map((r) => ({
          clause: r.clause.trim(),
          clientText: r.clientText.trim(),
          ourText: r.ourText.trim(),
        }))
        .filter((r) => r.clause || r.clientText || r.ourText);

      const res = await fetch("/api/contracts/update-platform-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractId,
          stateId: activeStateId,
          patch: { protocolRows: patchRows },
        }),
      });
      if (!res.ok) throw new Error("save failed");
      await loadData();
    } catch {
      setProtocolSaveError("Не удалось сохранить строки протокола.");
    } finally {
      setProtocolSaveBusy(false);
    }
  }

  return (
    <main className="contract-workspace contract-workspace--v2">
      <aside className="contract-side">
        <article className="card contract-side__top">
          <h3>Состояния</h3>
          {states.length === 0 ? (
            <p className="muted-text">Пока нет отправок. Добавьте текст или файл снизу.</p>
          ) : (
            <div className="contract-state-list">
              {states.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`contract-state ${activeStateId === s.id ? "active" : ""}`}
                  onClick={() => setActiveStateId(s.id)}
                >
                  <div className="contract-state__title">
                    {s.fileName ? "Файл от контрагента" : "Текст от контрагента"}
                  </div>
                  <div className="contract-state__meta">{formatDate(s.createdAt)}</div>
                  {s.fileName ? <div className="contract-state__meta muted-text">{s.fileName}</div> : null}
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="card contract-side__bottom">
          <h3>Ввод контрагента</h3>
          <p className="muted-text">Добавьте текст или файл. После отправки создаётся новое состояние.</p>
          {sendBusy ? (
            <div className="contract-ai-processing" style={{ marginTop: 10 }}>
              <div className="contract-ai-processing__spinner" aria-hidden="true" />
              <div className="contract-ai-processing__text">
                <strong>Идёт обработка</strong>
                <span>
                  Отправили запрос на платформу
                  <span className="contract-ai-processing__dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </span>
              </div>
              <span className="muted-text" style={{ fontSize: 12 }}>
                Ждём ответ
              </span>
            </div>
          ) : null}
          {sendError ? <p className="form-error" style={{ marginTop: 10 }}>{sendError}</p> : null}
          <div className="contract-input-actions">
            <button className="ghost-btn" type="button" disabled={isFinalized} onClick={() => openInput("text")}>
              Текст
            </button>
            <button className="ghost-btn" type="button" disabled={isFinalized} onClick={() => openInput("file")}>
              Файл
            </button>
          </div>
          {isFinalized ? <p className="muted-text">Дело завершено. Ввод и редактирование отключены.</p> : null}
        </article>
      </aside>

      <section className="contract-main">
        <header className="contract-main__header">
          <div>
            <span className="eyebrow">Открытое дело</span>
            <h1>{contract?.templateName || "Договор"}</h1>
            {loadError ? <p className="form-error">{loadError}</p> : null}
          </div>
          <div className="contract-main__actions">
            {templateFileUrl ? (
              <a className="ghost-btn ghost-btn--inline" href={templateFileUrl} target="_blank" rel="noreferrer">
                Открыть шаблон
              </a>
            ) : null}
            {!isFinalized ? (
              <button className="primary" type="button" onClick={() => setShowFinalize(true)}>
                Завершить
              </button>
            ) : (
              <span className="status ok">Дело завершено</span>
            )}
            <Link className="ghost-btn ghost-btn--inline" href="/">
              ← К контрагентам
            </Link>
          </div>
        </header>

        <article className="card contract-main__panel">
          <div className="contract-main__tabs">
            <button
              className={`contract-tab ${mainTab === "protocol" ? "active" : ""}`}
              type="button"
              onClick={() => setMainTab("protocol")}
            >
              Протокол
            </button>
            <button
              className={`contract-tab ${mainTab === "comments" ? "active" : ""}`}
              type="button"
              onClick={() => setMainTab("comments")}
            >
              Комментарии
            </button>
            <button
              className={`contract-tab ${mainTab === "template" ? "active" : ""}`}
              type="button"
              onClick={() => {
                setMainTab("template");
                void loadTemplate();
              }}
            >
              Текст шаблона
            </button>
          </div>

          <div className="contract-main__body">
            {!activeState ? (
              <p className="muted-text">Выберите состояние слева или отправьте текст/файл.</p>
            ) : mainTab === "protocol" ? (
              <>
                {activeState.summary ? <p className="analysis-summary">{activeState.summary}</p> : null}
                {protocolDraft.length === 0 ? (
                  <p className="muted-text">Пока нет строк протокола.</p>
                ) : (
                  <div className="analysis-protocol-table">
                    <div className="analysis-protocol-row analysis-protocol-row--head">
                      <div>Пункт</div>
                      <div>Позиция контрагента</div>
                      <div>Наша редакция</div>
                    </div>
                    {protocolDraft.map((row, index) => (
                      <div className="analysis-protocol-row" key={`${row.clause}-${index}`}>
                        <input
                          value={row.clause}
                          onChange={(e) =>
                            setProtocolDraft((prev) =>
                              prev.map((item, idx) => (idx === index ? { ...item, clause: e.target.value } : item)),
                            )
                          }
                        />
                        <textarea
                          rows={3}
                          value={row.clientText}
                          onChange={(e) =>
                            setProtocolDraft((prev) =>
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
                            setProtocolDraft((prev) =>
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
                      setProtocolDraft((prev) => [...prev, { clause: "", clientText: "", ourText: "" }])
                    }
                  >
                    Добавить строку
                  </button>
                  <button
                    className="ghost-btn"
                    type="button"
                    disabled={protocolSaveBusy}
                    onClick={() => void saveProtocolDraft()}
                  >
                    {protocolSaveBusy ? "Сохраняем..." : "Сохранить"}
                  </button>
                </div>
                {protocolSaveError ? <p className="form-error">{protocolSaveError}</p> : null}
              </>
            ) : mainTab === "comments" ? (
              <>
                {activeState.summary ? <p className="analysis-summary">{activeState.summary}</p> : null}
                {Array.isArray(activeState.protocolComments) && activeState.protocolComments.length > 0 ? (
                  <div className="analysis-comments">
                    {activeState.protocolComments.map((c) => (
                      <div
                        key={c.id}
                        className={`analysis-comment ${
                          c.severity === "critical"
                            ? "severity-critical"
                            : c.severity === "moderate"
                              ? "severity-moderate"
                              : "severity-minor"
                        }`}
                      >
                        <div className="analysis-comment__head">
                          <strong>{c.clause || "—"}</strong>
                          <span className="muted-text">{severityBadge(c.severity)}</span>
                        </div>
                        <p>{c.comment}</p>
                        {c.guidance ? <p className="muted-text">{c.guidance}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted-text">Пока нет комментариев.</p>
                )}
              </>
            ) : (
              <>
                {templateError ? <p className="form-error">{templateError}</p> : null}
                {templateBusy ? <p className="muted-text">Загружаем текст шаблона...</p> : null}
                {templateRules?.trim() ? (
                  <>
                    <h3>Правила</h3>
                    <div className="knowledge-doc-card__rules">{templateRules}</div>
                  </>
                ) : (
                  <p className="muted-text">Правила не указаны.</p>
                )}
                <h3 style={{ marginTop: 14 }}>Текст</h3>
                <pre className="analysis-text">{templateText?.trim() ? templateText : "Текст не извлечён."}</pre>
              </>
            )}
          </div>
        </article>
      </section>

      {isInputModalOpen ? (
        <div className="modal-root" role="dialog" aria-modal="true" aria-label="Ввод контрагента">
          <div className="modal-backdrop" onClick={() => setIsInputModalOpen(false)} />
          <div className="modal-card">
            <h3>{inputKind === "text" ? "Ввод текстом" : "Ввод файлом"}</h3>
            <form className="client-form" onSubmit={(e) => void sendToPlatformContract(e)}>
              {inputKind === "text" ? (
                <label className="field">
                  <span>Текст *</span>
                  <textarea
                    rows={8}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Например: 5.2 ограничить штраф…"
                  />
                </label>
              ) : (
                <label className="field">
                  <span>Файл *</span>
                  <input
                    key={inputFileKey}
                    type="file"
                    onChange={(e) => setInputFile(e.target.files?.[0] ?? null)}
                  />
                  {inputFile ? (
                    <span className="muted-text" style={{ marginTop: 6, display: "inline-block" }}>
                      {inputFile.name} • {formatFileSize(inputFile.size)}
                    </span>
                  ) : null}
                </label>
              )}

              {sendError ? <p className="form-error">{sendError}</p> : null}

              <div className="modal-actions">
                <button className="ghost-btn" type="button" onClick={() => setIsInputModalOpen(false)}>
                  Отмена
                </button>
                <button className="primary" type="submit" disabled={!canSend}>
                  {sendBusy ? "Отправляем..." : "Отправить"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showFinalize ? (
        <div className="modal-root" role="dialog" aria-modal="true" aria-label="Завершить дело">
          <div className="modal-backdrop" onClick={() => setShowFinalize(false)} />
          <div className="modal-card">
            <h3>Завершить дело?</h3>
            <p className="muted-text">
              После завершения ввод контрагента и редактирование протокола будут отключены. Финальный документ в
              интерфейсе не показываем, но состояние дела будет зафиксировано.
            </p>
            {finalizeError ? <p className="form-error">{finalizeError}</p> : null}
            <div className="modal-actions">
              <button className="ghost-btn" type="button" onClick={() => setShowFinalize(false)} disabled={finalizeBusy}>
                Отмена
              </button>
              <button
                className="primary"
                type="button"
                disabled={finalizeBusy}
                onClick={() => {
                  if (!contractId) return;
                  setFinalizeBusy(true);
                  setFinalizeError(null);
                  void fetch("/api/contracts/finalize", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contractId }),
                  })
                    .then(async (res) => {
                      if (!res.ok) throw new Error("finalize failed");
                      await loadData();
                      setShowFinalize(false);
                    })
                    .catch(() => {
                      setFinalizeError("Не удалось завершить дело.");
                    })
                    .finally(() => setFinalizeBusy(false));
                }}
              >
                {finalizeBusy ? "Завершаем..." : "Завершить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
