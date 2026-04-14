"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type OnlyOfficeMode = "view" | "edit";

type Props = {
  fileUrl: string;
  fileName?: string;
  mode?: OnlyOfficeMode;
};

type SignedPayload = {
  url: string;
  docId: string;
  exp: number;
  token: string;
  kind: "contracts" | "knowledge";
};

function getDocId(fileUrl: string): { docId: string; kind: SignedPayload["kind"] } | null {
  if (fileUrl.startsWith("/api/contracts/files/")) {
    return { docId: fileUrl.replace("/api/contracts/files/", ""), kind: "contracts" };
  }
  if (fileUrl.startsWith("/api/knowledge/files/")) {
    return { docId: fileUrl.replace("/api/knowledge/files/", ""), kind: "knowledge" };
  }
  return null;
}

function withBaseUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_ONLYOFFICE_FILE_BASE_URL || "";
  if (!base) return path;
  return `${base.replace(/\/$/, "")}${path}`;
}

function getFileType(fileName?: string): { fileType: string; documentType: "word" | "cell" | "slide" } {
  const fallback = { fileType: "docx", documentType: "word" as const };
  if (!fileName) return fallback;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!ext) return fallback;
  if (["xlsx", "xls", "csv"].includes(ext)) {
    return { fileType: ext, documentType: "cell" };
  }
  if (["pptx", "ppt"].includes(ext)) {
    return { fileType: ext, documentType: "slide" };
  }
  return { fileType: ext, documentType: "word" };
}

export function OnlyOfficeViewer({ fileUrl, fileName, mode = "view" }: Props) {
  const tenantId = process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID ?? "local-tenant";
  const agentId = process.env.NEXT_PUBLIC_PLATFORM_AGENT_ID ?? "jurist3-agent";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signed, setSigned] = useState<SignedPayload | null>(null);
  const { fileType, documentType } = useMemo(() => getFileType(fileName), [fileName]);
  const onlyOfficeUrl = process.env.NEXT_PUBLIC_ONLYOFFICE_URL || "";
  const scriptSrc = onlyOfficeUrl
    ? `${onlyOfficeUrl.replace(/\/$/, "")}/web-apps/apps/api/documents/api.js`
    : "";
  const docUrl = signed ? withBaseUrl(signed.url) : "";

  const docMeta = useMemo(() => getDocId(fileUrl), [fileUrl]);

  useEffect(() => {
    let active = true;
    async function sign() {
      if (!docMeta) return;
      setLoadError(null);
      try {
        const response = await fetch(
          `/api/files/sign?docId=${encodeURIComponent(docMeta.docId)}&kind=${docMeta.kind}`,
        );
        if (!response.ok) {
          throw new Error("sign failed");
        }
        const payload = (await response.json()) as SignedPayload;
        if (active) {
          setSigned(payload);
        }
      } catch {
        if (active) {
          setLoadError("Unable to sign document URL.");
        }
      }
    }

    void sign();
    return () => {
      active = false;
    };
  }, [docMeta]);


  useEffect(() => {
    if (!signed || !containerRef.current) return;

    const onlyOfficeUrl = process.env.NEXT_PUBLIC_ONLYOFFICE_URL || "";
    if (!onlyOfficeUrl) {
      setLoadError("ONLYOFFICE url not configured.");
      setLoading(false);
      return;
    }

    const scriptId = "onlyoffice-api";
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    const scriptSrc = `${onlyOfficeUrl.replace(/\/$/, "")}/web-apps/apps/api/documents/api.js`;
    const timeoutId = window.setTimeout(() => {
      setLoadError(`OnlyOffice not reachable: ${scriptSrc}`);
      setLoading(false);
    }, 8000);

    function initEditor() {
      if (!containerRef.current) return;
      if (!window || !(window as any).DocsAPI) {
        setLoadError("OnlyOffice API unavailable.");
        setLoading(false);
        return;
      }

      if (editorRef.current) {
        editorRef.current.destroyEditor?.();
        editorRef.current = null;
      }
      containerRef.current.innerHTML = "";

      const callbackUrl =
        mode === "edit"
          ? withBaseUrl(
              `/api/contracts/onlyoffice-callback?docId=${encodeURIComponent(signed.docId)}` +
                `&token=${encodeURIComponent(signed.token)}&exp=${signed.exp}` +
                `&tenantId=${encodeURIComponent(tenantId)}&agentId=${encodeURIComponent(agentId)}`,
            )
          : undefined;

      const config = {
        document: {
          fileType,
          key: `${signed.docId}-${signed.exp}`,
          title: fileName ?? signed.docId,
          url: withBaseUrl(signed.url),
          permissions: {
            edit: mode === "edit",
            download: true,
            print: false,
            comment: false,
            review: false,
          },
        },
        documentType,
        editorConfig: {
          mode,
          callbackUrl,
          user: {
            id: "user",
            name: "User",
          },
          customization: {
            compactToolbar: true,
            toolbarNoTabs: true,
            hideRightMenu: true,
            hideRulers: true,
            forcesave: false,
          },
        },
        events: {
          onAppReady: () => {
            setLoading(false);
          },
          onDocumentReady: () => {
            setLoading(false);
          },
          onError: (event: any) => {
            const message = event ? JSON.stringify(event) : "unknown";
            setLoadError(`OnlyOffice error: ${message}`);
            setLoading(false);
          },
        },
        width: "100%",
        height: "100%",
      };

      const containerId = containerRef.current.id || `onlyoffice-${signed.docId}`;
      containerRef.current.id = containerId;
      try {
        editorRef.current = new (window as any).DocsAPI.DocEditor(
          containerId,
          config,
        );
        setLoading(false);
        window.clearTimeout(timeoutId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLoadError(`OnlyOffice init error: ${message}`);
        setLoading(false);
        window.clearTimeout(timeoutId);
        return;
      }

    }

    if (existing) {
      initEditor();
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = scriptSrc;
    script.onload = initEditor;
    script.onerror = () => {
      setLoadError(`Failed to load OnlyOffice API: ${scriptSrc}`);
      setLoading(false);
      window.clearTimeout(timeoutId);
    };
    document.body.appendChild(script);

    return () => {
      window.clearTimeout(timeoutId);
      if (editorRef.current) {
        editorRef.current.destroyEditor?.();
        editorRef.current = null;
      }
    };
  }, [signed, mode]);

  return (
    <div className="onlyoffice-frame">
      <div className="onlyoffice-status">
        {loadError ? <p className="form-error">{loadError}</p> : null}
        {loading && !loadError ? <p className="muted-text">Loading editor...</p> : null}
      </div>
      <div className="onlyoffice-container" ref={containerRef} />
    </div>
  );
}
