"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ContractDraft } from "@/lib/contracts/types";
import type { ProfileSettings } from "@/lib/profile/types";
import type { KnowledgeDocument, KnowledgeScope, KnowledgeSection } from "@/lib/knowledge/types";

type Section = "contracts" | "profile" | "knowledge" | "settings";

type Client = {
  id: string;
  companyName: string;
  notes: string;
  createdAt: string;
};

const navItems: Array<{ id: Section; label: string }> = [
  { id: "contracts", label: "Работа с договорами" },
  { id: "profile", label: "Профиль" },
  { id: "knowledge", label: "База знаний" },
  { id: "settings", label: "Настройки" },
];

const knowledgeItems: Array<{
  id: KnowledgeSection;
  title: string;
  subtitle: string;
}> = [
  {
    id: "templates",
    title: "Шаблоны",
    subtitle: "Договоры, которые используются как база при подписании.",
  },
  {
    id: "rules",
    title: "Правила",
    subtitle: "Набор правил для проверки формулировок и автокомментариев.",
  },
  {
    id: "fz",
    title: "ФЗ",
    subtitle: "Нормативная база и выдержки из федеральных законов.",
  },
];

const knowledgeScope: KnowledgeScope = {
  tenantId: process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID ?? "local-tenant",
  agentId: process.env.NEXT_PUBLIC_PLATFORM_AGENT_ID ?? "jurist3-agent",
};

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

export function AppShell() {
  const [hydrated, setHydrated] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("contracts");
  const [openKnowledgeSection, setOpenKnowledgeSection] =
    useState<KnowledgeSection | null>("templates");
  const [clients, setClients] = useState<Client[]>([]);
  const [contracts, setContracts] = useState<ContractDraft[]>([]);
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDocument[]>([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [contractsLoaded, setContractsLoaded] = useState(false);
  const [knowledgeLoaded, setKnowledgeLoaded] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const defaultProfile: ProfileSettings = {
    googleDocs: {
      enabled: false,
      driveFolderId: "",
      credentialsJson: "",
    },
    gmail: {
      enabled: false,
      fromEmail: "",
      appPassword: "",
      smtpHost: "smtp.gmail.com",
      smtpPort: "465",
    },
  };
  const [profileSettings, setProfileSettings] = useState<ProfileSettings>(defaultProfile);

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [contractsViewMode, setContractsViewMode] = useState<"active" | "archive">("active");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isComposeModalOpen, setIsComposeModalOpen] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [composeError, setComposeError] = useState<string | null>(null);
  const [isTemplateDropdownOpen, setIsTemplateDropdownOpen] = useState(false);
  const [knowledgeUploadError, setKnowledgeUploadError] = useState<string | null>(null);

  const fileInputsRef = useRef<Record<KnowledgeSection, HTMLInputElement | null>>({
    templates: null,
    rules: null,
    fz: null,
  });
  const templateDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const headers = {
      "x-tenant-id": knowledgeScope.tenantId,
      "x-agent-id": knowledgeScope.agentId,
    };
    void (async () => {
      const [clientsRes, contractsRes, knowledgeRes, profileRes] = await Promise.all([
        fetch("/api/storage/clients", { headers }),
        fetch("/api/storage/contracts", { headers }),
        fetch("/api/storage/knowledge", { headers }),
        fetch("/api/storage/profile", { headers }),
      ]);
      if ([clientsRes, contractsRes, knowledgeRes, profileRes].some((res) => res.status === 401)) {
        window.location.href = "/login";
        return;
      }
      const clientsPayload = (await clientsRes.json().catch(() => null)) as { items?: Client[] } | null;
      const contractsPayload = (await contractsRes.json().catch(() => null)) as { items?: ContractDraft[] } | null;
      const knowledgePayload = (await knowledgeRes.json().catch(() => null)) as { items?: KnowledgeDocument[] } | null;
      const profilePayload = (await profileRes.json().catch(() => null)) as { data?: ProfileSettings } | null;

      if (Array.isArray(clientsPayload?.items)) setClients(clientsPayload.items);
      if (Array.isArray(contractsPayload?.items)) setContracts(contractsPayload.items);
      if (Array.isArray(knowledgePayload?.items)) setKnowledgeDocs(knowledgePayload.items);
      setClientsLoaded(true);
      setContractsLoaded(true);
      setKnowledgeLoaded(true);
      if (profilePayload?.data) {
        setProfileSettings({
          ...defaultProfile,
          ...profilePayload.data,
          googleDocs: {
            ...defaultProfile.googleDocs,
            ...(profilePayload.data as ProfileSettings).googleDocs,
          },
          gmail: {
            ...defaultProfile.gmail,
            ...(profilePayload.data as ProfileSettings).gmail,
          },
        });
      }
      setProfileLoaded(true);
    })();
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated || !clientsLoaded) return;
    const headers = {
      "Content-Type": "application/json",
      "x-tenant-id": knowledgeScope.tenantId,
      "x-agent-id": knowledgeScope.agentId,
    };
    void fetch("/api/storage/clients", { method: "POST", headers, body: JSON.stringify({ items: clients }) });
  }, [clients, hydrated, clientsLoaded]);

  useEffect(() => {
    if (!hydrated || !contractsLoaded) return;
    const headers = {
      "Content-Type": "application/json",
      "x-tenant-id": knowledgeScope.tenantId,
      "x-agent-id": knowledgeScope.agentId,
    };
    void fetch("/api/storage/contracts", { method: "POST", headers, body: JSON.stringify({ items: contracts }) });
  }, [contracts, hydrated, contractsLoaded]);

  useEffect(() => {
    if (!hydrated || !knowledgeLoaded) return;
    const headers = {
      "Content-Type": "application/json",
      "x-tenant-id": knowledgeScope.tenantId,
      "x-agent-id": knowledgeScope.agentId,
    };
    void fetch("/api/storage/knowledge", { method: "POST", headers, body: JSON.stringify({ items: knowledgeDocs }) });
  }, [knowledgeDocs, hydrated, knowledgeLoaded]);

  useEffect(() => {
    if (!hydrated || !profileLoaded) return;
    const headers = {
      "Content-Type": "application/json",
      "x-tenant-id": knowledgeScope.tenantId,
      "x-agent-id": knowledgeScope.agentId,
    };
    void fetch("/api/storage/profile", { method: "POST", headers, body: JSON.stringify({ data: profileSettings }) });
  }, [profileSettings, hydrated, profileLoaded]);

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
    () => selectedClientContracts.filter((item) => item.status !== "archived"),
    [selectedClientContracts],
  );
  const selectedClientArchivedContracts = useMemo(
    () => selectedClientContracts.filter((item) => item.status === "archived"),
    [selectedClientContracts],
  );
  const selectedTemplate = useMemo(
    () => availableTemplates.find((item) => item.id === selectedTemplateId) ?? null,
    [availableTemplates, selectedTemplateId],
  );
  const docsReady = useMemo(() => {
    if (!profileSettings.googleDocs.enabled) {
      return true;
    }

    return Boolean(
      profileSettings.googleDocs.driveFolderId.trim() &&
        profileSettings.googleDocs.credentialsJson.trim(),
    );
  }, [profileSettings.googleDocs]);
  const gmailReady = useMemo(() => {
    if (!profileSettings.gmail.enabled) {
      return true;
    }

    return Boolean(profileSettings.gmail.fromEmail.trim() && profileSettings.gmail.appPassword.trim());
  }, [profileSettings.gmail]);

  function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

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

    setClients((prev) => [newClient, ...prev]);
    setCompanyName("");
    setNotes("");
    setFormError(null);
    setIsCreateModalOpen(false);
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
  }

  function openComposeModal() {
    setIsComposeModalOpen(true);
    setComposeError(null);
    setSelectedTemplateId("");
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
  }

  async function createContractDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedClientId) {
      return;
    }

    if (!selectedTemplateId) {
      setComposeError("Выберите шаблон договора.");
      return;
    }

    const template = availableTemplates.find((item) => item.id === selectedTemplateId);
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

    const newDraft: ContractDraft = {
      id: crypto.randomUUID(),
      clientId: selectedClientId,
      templateDocId: template.id,
      templateName: template.fileName,
      templateFileUrl: template.fileUrl,
      createdAt: new Date().toISOString(),
      status: "draft",
      iterations: [
        {
          id: crypto.randomUUID(),
          title: "Договор создан",
          content:
            `Шаблон договора: ${template.fileName}\n\n` +
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

  function triggerFilePicker(section: KnowledgeSection) {
    fileInputsRef.current[section]?.click();
  }

  async function addKnowledgeFiles(section: KnowledgeSection, fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const docs: KnowledgeDocument[] = [];
    const failedFiles: string[] = [];
    setKnowledgeUploadError(null);

    for (const file of Array.from(fileList)) {
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
        failedFiles.push(file.name);
        continue;
      }

      const doc: KnowledgeDocument = {
        id: crypto.randomUUID(),
        tenantId: knowledgeScope.tenantId,
        agentId: knowledgeScope.agentId,
        section,
        fileName: file.name,
        fileUrl,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        uploadedAt: new Date().toISOString(),
      };

      docs.push(doc);
    }

    if (failedFiles.length > 0) {
      setKnowledgeUploadError(
        `Не удалось загрузить ${failedFiles.length} файл(ов): ${failedFiles.join(", ")}`,
      );
    }

    setKnowledgeDocs((prev) => [...docs, ...prev]);
  }

  function removeKnowledgeDoc(id: string) {
    setKnowledgeDocs((prev) => prev.filter((doc) => doc.id !== id));
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

  function updateGoogleDocsSettings(next: Partial<ProfileSettings["googleDocs"]>) {
    setProfileSettings((prev) => ({
      ...prev,
      googleDocs: {
        ...prev.googleDocs,
        ...next,
      },
    }));
  }

  function updateGmailSettings(next: Partial<ProfileSettings["gmail"]>) {
    setProfileSettings((prev) => ({
      ...prev,
      gmail: {
        ...prev.gmail,
        ...next,
      },
    }));
  }

  function renderContractsSection() {
    if (selectedClient) {
      return (
        <section className="workspace-stack">
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
            <p>Карточка организации. Здесь создаем черновики договоров на основе шаблонов.</p>
            <div className="header-actions">
              <button className="primary" onClick={openComposeModal} type="button">
                Составить договор
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
            <article className="card">
              <h3>Черновики договоров</h3>
              {selectedClientActiveContracts.length === 0 ? (
                <p className="muted-text">
                  Черновиков пока нет. Нажмите &quot;Составить договор&quot; и выберите шаблон.
                </p>
              ) : (
                <div className="draft-list">
                  {selectedClientActiveContracts.map((draft) => (
                    <div className="draft-card" key={draft.id}>
                      <div className="draft-card__title">{draft.templateName}</div>
                      <div className="draft-card__meta">Создан: {formatDate(draft.createdAt)}</div>
                      <div className="draft-card__meta">Статус: черновик</div>
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
            <article className="card">
              <h3>Архив договоров</h3>
              {selectedClientArchivedContracts.length === 0 ? (
                <p className="muted-text">Архив пуст.</p>
              ) : (
                <div className="draft-list">
                  {selectedClientArchivedContracts.map((draft) => (
                    <div className="draft-card" key={draft.id}>
                      <div className="draft-card__title">{draft.templateName}</div>
                      <div className="draft-card__meta">Создан: {formatDate(draft.createdAt)}</div>
                      <div className="draft-card__meta">Статус: завершен</div>
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
            <div className="modal-root" role="dialog" aria-modal="true" aria-label="Составить договор">
              <div className="modal-backdrop" onClick={closeComposeModal} />
              <div className="modal-card">
                <h3>Составить договор</h3>
                <form className="client-form" onSubmit={createContractDraft}>
                  <label className="field">
                    <span>Выберите шаблон договора *</span>
                    <div className="template-dropdown" ref={templateDropdownRef}>
                      <button
                        className={`template-dropdown__trigger ${isTemplateDropdownOpen ? "open" : ""}`}
                        onClick={() => setIsTemplateDropdownOpen((prev) => !prev)}
                        type="button"
                      >
                        <span className={selectedTemplate ? "" : "template-dropdown__placeholder"}>
                          {selectedTemplate ? selectedTemplate.fileName : "Выберите шаблон"}
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

                  {availableTemplates.length === 0 ? (
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
                    <button className="primary" disabled={availableTemplates.length === 0} type="submit">
                      Создать черновик
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
          <h1>Работа с договорами</h1>
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
                  <button className="primary" type="submit">
                    Сохранить
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
    return (
      <section className="workspace-stack">
        <div className="workspace-header">
          <h1>База знаний</h1>
          <p>Добавляйте документы по разделам. В каждом разделе сразу показывается список файлов.</p>
          <p className="scope-text">
            Контур хранения: tenant <b>{knowledgeScope.tenantId}</b> / agent <b>{knowledgeScope.agentId}</b>
          </p>
        </div>

        <div className="knowledge-accordion">
          {knowledgeItems.map((item) => {
            const sectionDocs = knowledgeDocs.filter((doc) => doc.section === item.id);

            return (
              <article className="knowledge-accordion-item" key={item.id}>
                <button
                  className={`knowledge-toggle ${openKnowledgeSection === item.id ? "active" : ""}`}
                  onClick={() =>
                    setOpenKnowledgeSection((prev) => (prev === item.id ? null : item.id))
                  }
                  type="button"
                >
                  <span className="knowledge-toggle__title">{item.title}</span>
                  <span className="knowledge-toggle__icon">
                    {openKnowledgeSection === item.id ? "−" : "+"}
                  </span>
                </button>

                {openKnowledgeSection === item.id ? (
                  <div className="knowledge-panel">
                    <p className="muted-text">{item.subtitle}</p>
                    <div className="knowledge-actions">
                      <button className="primary" onClick={() => triggerFilePicker(item.id)} type="button">
                        Добавить документ
                      </button>
                      <input
                        className="hidden-file-input"
                        multiple
                        onChange={(event) => {
                          void addKnowledgeFiles(item.id, event.target.files);
                          event.currentTarget.value = "";
                        }}
                        ref={(node) => {
                          fileInputsRef.current[item.id] = node;
                        }}
                        type="file"
                      />
                    </div>
                    {knowledgeUploadError ? <p className="form-error">{knowledgeUploadError}</p> : null}

                    {sectionDocs.length === 0 ? (
                      <div className="knowledge-empty">В этом разделе пока нет документов.</div>
                    ) : (
                      <div className="knowledge-doc-grid">
                        {sectionDocs.map((doc) => (
                          <div className="knowledge-doc-card" key={doc.id}>
                            <div className="knowledge-doc-card__head">
                              <span className="knowledge-doc-card__name">{doc.fileName}</span>
                              <button
                                className="knowledge-doc-card__remove"
                                onClick={() => removeKnowledgeDoc(doc.id)}
                                type="button"
                              >
                                Удалить
                              </button>
                            </div>
                            <div className="knowledge-doc-card__meta">
                              <span>{formatFileSize(doc.fileSize)}</span>
                              <span>{formatDate(doc.uploadedAt)}</span>
                              <span>{doc.mimeType}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  function renderProfileSection() {
    return (
      <section className="workspace-stack">
        <div className="workspace-header">
          <h1>Профиль</h1>
          <p>Раздел для данных компании. Интеграции Google перенесены в Настройки.</p>
        </div>

        <article className="card profile-card">
          <div className="profile-card__head">
            <h3>Данные компании (автоподстановка)</h3>
            <span className="integration-status warn">Скоро</span>
          </div>
          <p className="muted-text">
            Место под реквизиты и подписантов. На следующем этапе подключим автозаполнение
            договоров из этих данных.
          </p>
          <div className="profile-grid profile-grid--disabled">
            <label className="field">
              <span>Юр. лицо</span>
              <input disabled placeholder="ООО Компания" type="text" />
            </label>
            <label className="field">
              <span>ИНН / КПП</span>
              <input disabled placeholder="0000000000 / 000000000" type="text" />
            </label>
            <label className="field">
              <span>ОГРН</span>
              <input disabled placeholder="0000000000000" type="text" />
            </label>
            <label className="field">
              <span>Подписант</span>
              <input disabled placeholder="Иванов И.И., Генеральный директор" type="text" />
            </label>
          </div>
        </article>
      </section>
    );
  }

  function renderSettingsSection() {
    return (
      <section className="workspace-stack">
        <div className="workspace-header">
          <h1>Настройки</h1>
          <p>
            Интеграции с Google сервисами. Чекбокс &quot;Включить&quot; означает, что модуль
            работает параллельно.
          </p>
        </div>

        <article className="card profile-card">
          <div className="profile-card__head">
            <h3>Google Docs</h3>
            <span className={`integration-status ${docsReady ? "ok" : "bad"}`}>
              {docsReady ? "Готово" : "Незаполнено"}
            </span>
          </div>

          <label className="toggle-row">
            <input
              checked={profileSettings.googleDocs.enabled}
              onChange={(event) => updateGoogleDocsSettings({ enabled: event.target.checked })}
              type="checkbox"
            />
            <span>Включить</span>
          </label>

          {profileSettings.googleDocs.enabled ? (
            <div className="client-form">
              <label className="field">
                <span>ID папки в Google Drive</span>
                <input
                  onChange={(event) => updateGoogleDocsSettings({ driveFolderId: event.target.value })}
                  placeholder="1abcDEFghIJK..."
                  type="text"
                  value={profileSettings.googleDocs.driveFolderId}
                />
              </label>

              <label className="field">
                <span>Service Account JSON / ключ</span>
                <textarea
                  onChange={(event) => updateGoogleDocsSettings({ credentialsJson: event.target.value })}
                  placeholder="JSON сервисного аккаунта или ссылка на секрет"
                  rows={5}
                  value={profileSettings.googleDocs.credentialsJson}
                />
              </label>
            </div>
          ) : (
            <div className="integration-hidden" />
          )}

          <p className="integration-help">
            1) Создайте Service Account в Google Cloud и включите Drive API + Docs API. 2) Дайте
            этому аккаунту доступ к папке в Google Drive (Editor). 3) Вставьте ID папки и JSON ключ.
            После этого система сможет создавать и вести Google Документы по договорам.
          </p>
        </article>

        <article className="card profile-card">
          <div className="profile-card__head">
            <h3>Gmail</h3>
            <span className={`integration-status ${gmailReady ? "ok" : "bad"}`}>
              {gmailReady ? "Готово" : "Незаполнено"}
            </span>
          </div>

          <label className="toggle-row">
            <input
              checked={profileSettings.gmail.enabled}
              onChange={(event) => updateGmailSettings({ enabled: event.target.checked })}
              type="checkbox"
            />
            <span>Включить</span>
          </label>

          {profileSettings.gmail.enabled ? (
            <div className="profile-grid">
              <label className="field">
                <span>Отправитель (Gmail)</span>
                <input
                  onChange={(event) => updateGmailSettings({ fromEmail: event.target.value })}
                  placeholder="legal@company.com"
                  type="email"
                  value={profileSettings.gmail.fromEmail}
                />
              </label>

              <label className="field">
                <span>Пароль приложения</span>
                <input
                  onChange={(event) => updateGmailSettings({ appPassword: event.target.value })}
                  placeholder="xxxx xxxx xxxx xxxx"
                  type="password"
                  value={profileSettings.gmail.appPassword}
                />
              </label>

              <label className="field">
                <span>SMTP host</span>
                <input
                  onChange={(event) => updateGmailSettings({ smtpHost: event.target.value })}
                  placeholder="smtp.gmail.com"
                  type="text"
                  value={profileSettings.gmail.smtpHost}
                />
              </label>

              <label className="field">
                <span>SMTP port</span>
                <input
                  onChange={(event) => updateGmailSettings({ smtpPort: event.target.value })}
                  placeholder="465"
                  type="text"
                  value={profileSettings.gmail.smtpPort}
                />
              </label>
            </div>
          ) : (
            <div className="integration-hidden" />
          )}

          <p className="integration-help">
            1) В Gmail включите двухфакторную аутентификацию. 2) Создайте App Password в разделе
            безопасности Google аккаунта. 3) Укажите почту отправителя и App Password. После этого
            можно отправлять итерации клиенту напрямую из системы.
          </p>
        </article>
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

        <section className="sidebar-block">
          <button className="ghost-btn" onClick={handleLogout} type="button">
            Выйти
          </button>
        </section>
      </aside>

      <main className="workspace">
        {activeSection === "contracts" ? renderContractsSection() : null}
        {activeSection === "profile" ? renderProfileSection() : null}
        {activeSection === "knowledge" ? renderKnowledgeSection() : null}
        {activeSection === "settings" ? renderSettingsSection() : null}
      </main>
    </div>
  );
}
