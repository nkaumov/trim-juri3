"use client";

import { useEffect, useMemo, useRef, useState } from "react";

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (placeholderId: string, config: object) => {
        destroyEditor?: () => void;
      };
    };
  }
}

type Props = {
  fileUrl?: string | null;
  fileName?: string | null;
  isVisible?: boolean;
};

let docsApiScriptPromise: Promise<void> | null = null;

function buildDocumentKey(fileName: string, fileUrl: string): string {
  const raw = `${fileName}-${fileUrl}`;
  const safe = raw.replace(/[^0-9A-Za-z._-]/g, "_");
  return safe.slice(0, 120) || "contract_document";
}

function fileTypeByName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return ext || "docx";
}

function documentTypeByName(fileName: string): "word" | "cell" | "slide" {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["xlsx", "xls", "csv"].includes(ext)) {
    return "cell";
  }
  if (["pptx", "ppt"].includes(ext)) {
    return "slide";
  }
  return "word";
}

function getApiPath(fileUrl?: string | null): string | null {
  if (!fileUrl) {
    return null;
  }
  if (fileUrl.startsWith("/api/")) {
    return fileUrl;
  }
  try {
    const parsed = new URL(fileUrl);
    if (parsed.pathname.startsWith("/api/")) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return null;
  }
  return null;
}

export function OnlyOfficeViewer({ fileUrl, fileName, isVisible = true }: Props) {
  const containerId = useMemo(() => `oo-${crypto.randomUUID()}`, []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<{ destroyEditor?: () => void } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const [editorHeight, setEditorHeight] = useState(720);
  const [signedUrl, setSignedUrl] = useState<string>("");
  const apiPath = useMemo(() => getApiPath(fileUrl), [fileUrl]);
  const readyDocumentUrl = useMemo(() => {
    if (apiPath && !signedUrl) {
      return "";
    }
    if (signedUrl) {
      return signedUrl;
    }
    if (!fileUrl || !fileName) {
      return "";
    }
    const fileBaseUrl = (process.env.NEXT_PUBLIC_ONLYOFFICE_FILE_BASE_URL ?? window.location.origin).replace(
      /\/$/,
      "",
    );
    return fileUrl.startsWith("http") ? fileUrl : `${fileBaseUrl}${fileUrl}`;
  }, [apiPath, fileUrl, fileName, signedUrl]);

  useEffect(() => {
    function syncHeight() {
      const next = Math.max(window.innerHeight - 250, 460);
      setEditorHeight(next);
    }

    syncHeight();
    window.addEventListener("resize", syncHeight);
    return () => window.removeEventListener("resize", syncHeight);
  }, []);

  useEffect(() => {
    if (!readyDocumentUrl || !fileName) {
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
      return;
    }

    const onlyOfficeUrl = (process.env.NEXT_PUBLIC_ONLYOFFICE_URL ?? "http://localhost:8080").replace(
      /\/$/,
      "",
    );
    const scriptUrl = `${onlyOfficeUrl}/web-apps/apps/api/documents/api.js`;
    let cancelled = false;

    function renderEditor() {
      if (cancelled || !window.DocsAPI?.DocEditor) {
        return;
      }

      const container = containerRef.current;
      if (container) {
        container.innerHTML = "";
      }

      editorRef.current?.destroyEditor?.();
      const instance = new window.DocsAPI.DocEditor(containerId, {
        document: {
          fileType: fileTypeByName(fileName),
          key: buildDocumentKey(fileName, fileUrl ?? ""),
          title: fileName,
          url: readyDocumentUrl,
          permissions: {
            edit: false,
            comment: false,
            review: false,
            fillForms: false,
          },
        },
        documentType: documentTypeByName(fileName),
        editorConfig: {
          mode: "view",
          lang: "ru",
          customization: {
            compactHeader: true,
            compactToolbar: true,
            zoom: 85,
            toolbarHideFileName: false,
          },
        },
        events: {
          onError: () => {
            if (!cancelled) {
              setLoadError("OnlyOffice не смог открыть документ. Проверьте доступность файла и контейнера.");
            }
          },
        },
        type: "desktop",
        width: "100%",
        height: `${editorHeight}px`,
      });
      editorRef.current = instance;
    }

    async function ensureScript() {
      if (window.DocsAPI?.DocEditor) {
        return;
      }

      if (!docsApiScriptPromise) {
        docsApiScriptPromise = new Promise<void>((resolve, reject) => {
          const existing = document.querySelector<HTMLScriptElement>(`script[src="${scriptUrl}"]`);
          if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error("Script load failed")), { once: true });
            return;
          }

          const script = document.createElement("script");
          script.src = scriptUrl;
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Script load failed"));
          document.body.appendChild(script);
        });
      }

      await docsApiScriptPromise;
    }

    void ensureScript()
      .then(() => {
        renderEditor();
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("OnlyOffice API недоступен. Проверьте контейнер и URL в .env.");
        }
      });

    return () => {
      cancelled = true;
      editorRef.current?.destroyEditor?.();
      editorRef.current = null;
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [containerId, editorHeight, fileName, fileUrl, readyDocumentUrl]);

  useEffect(() => {
    if (!fileUrl) {
      setSignedUrl("");
      setSignError(null);
      return;
    }
    if (!apiPath) {
      setSignedUrl("");
      setSignError(null);
      return;
    }
    const kind = apiPath.startsWith("/api/knowledge/") ? "knowledge" : "contracts";
    const docId = apiPath.split("/").pop() || "";
    void (async () => {
      try {
        const response = await fetch(`/api/files/sign?docId=${encodeURIComponent(docId)}&kind=${kind}`);
        if (!response.ok) {
          setSignError("Не удалось получить подписанную ссылку для OnlyOffice. Проверьте DOCUMENTS_SIGNING_KEY и перезапустите сервер.");
          return;
        }
        const payload = (await response.json()) as { url?: string };
        if (payload.url) {
          const fileBaseUrl = (process.env.NEXT_PUBLIC_ONLYOFFICE_FILE_BASE_URL ?? window.location.origin).replace(
            /\/$/,
            "",
          );
          setSignedUrl(payload.url.startsWith("http") ? payload.url : `${fileBaseUrl}${payload.url}`);
          setSignError(null);
        }
      } catch {
        setSignError("Не удалось получить подписанную ссылку для OnlyOffice. Проверьте DOCUMENTS_SIGNING_KEY и перезапустите сервер.");
      }
    })();
  }, [apiPath, fileUrl]);

  const statusText = signError
    ? signError
    : !readyDocumentUrl
    ? "Подготавливаем документ..."
    : loadError
      ? loadError
      : "";

  return (
    <div className={`onlyoffice-shell ${isVisible ? "" : "empty"}`}>
      <div className={`onlyoffice-status ${statusText ? "visible" : ""}`} aria-live="polite">
        {statusText}
      </div>
      <div
        className="onlyoffice-viewer"
        id={containerId}
        ref={containerRef}
        style={{ height: `${editorHeight}px` }}
      />
    </div>
  );
}
