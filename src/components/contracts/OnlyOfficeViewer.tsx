"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePublicConfig } from "@/lib/usePublicConfig";

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

function withBaseUrl(path: string, base: string): string {
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
  const { config: publicConfig } = usePublicConfig();
  const tenantId = publicConfig?.platformTenantId ?? "local-tenant";
  const agentId = publicConfig?.platformAgentId ?? "jurist3-agent";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signed, setSigned] = useState<SignedPayload | null>(null);
  const { fileType, documentType } = useMemo(() => getFileType(fileName), [fileName]);
  const onlyOfficeUrl = publicConfig?.onlyofficeUrl || "";
  const onlyOfficeFileBaseUrl = publicConfig?.onlyofficeFileBaseUrl || "";
  const scriptSrc = onlyOfficeUrl
    ? `${onlyOfficeUrl.replace(/\/$/, "")}/web-apps/apps/api/documents/api.js`
    : "";
  const docUrl = signed ? withBaseUrl(signed.url, onlyOfficeFileBaseUrl) : "";

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
    const signedData = signed;

    setLoadError(null);
    setLoading(true);

    const onlyOfficeUrl = publicConfig?.onlyofficeUrl || "";
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
    }, 30000);

    function initEditor() {
      // Script can take a while to load behind tunnels/cold starts; avoid false negatives.
      window.clearTimeout(timeoutId);
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
              `/api/contracts/onlyoffice-callback?docId=${encodeURIComponent(signedData.docId)}` +
                `&token=${encodeURIComponent(signedData.token)}&exp=${signedData.exp}` +
                `&tenantId=${encodeURIComponent(tenantId)}&agentId=${encodeURIComponent(agentId)}`,
              onlyOfficeFileBaseUrl,
            )
          : undefined;

      const config = {
        document: {
          fileType,
          key: `${signedData.docId}-${signedData.exp}`,
          title: fileName ?? signedData.docId,
          url: withBaseUrl(signedData.url, onlyOfficeFileBaseUrl),
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

      const containerId = containerRef.current.id || `onlyoffice-${signedData.docId}`;
      containerRef.current.id = containerId;
      try {
        editorRef.current = new (window as any).DocsAPI.DocEditor(
          containerId,
          config,
        );
        setLoadError(null);
        setLoading(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLoadError(`OnlyOffice init error: ${message}`);
        setLoading(false);
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
  }, [
    agentId,
    documentType,
    fileName,
    fileType,
    onlyOfficeFileBaseUrl,
    onlyOfficeUrl,
    signed,
    mode,
    tenantId,
  ]);

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
