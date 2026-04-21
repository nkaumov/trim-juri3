import { NextResponse } from "next/server";
import { getDocument } from "@/lib/documents";
import { requireSessionUser } from "@/lib/auth";
import { verifyDocumentToken } from "@/lib/doc-sign";
import { isUnauthorizedError, unauthorizedResponse } from "@/lib/http-errors";

export const runtime = "nodejs";

function contentTypeByName(fileName?: string | null): string {
  if (!fileName) {
    return "application/octet-stream";
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".doc")) {
    return "application/msword";
  }
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".txt")) {
    return "text/plain; charset=utf-8";
  }
  return "application/octet-stream";
}

function buildHeaders(fileName: string): HeadersInit {
  return {
    "Content-Type": contentTypeByName(fileName),
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "private, max-age=60",
  };
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await context.params;
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";
    const exp = Number(url.searchParams.get("exp") || "0");
    if (token && verifyDocumentToken(name, exp, token)) {
      const document = await getDocument(name);
      if (!document) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      return new NextResponse(null, { status: 200, headers: buildHeaders(document.fileName) });
    }
    const user = await requireSessionUser();
    const document = await getDocument(name, { tenantId: user.id, agentId: "jurist3-agent" });
    if (!document) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return new NextResponse(null, {
      status: 200,
      headers: buildHeaders(document.fileName),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) return unauthorizedResponse();
    throw error;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await context.params;
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";
    const exp = Number(url.searchParams.get("exp") || "0");
    if (token && verifyDocumentToken(name, exp, token)) {
      const document = await getDocument(name);
      if (!document) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      return new NextResponse(new Uint8Array(document.buffer), {
        status: 200,
        headers: buildHeaders(document.fileName),
      });
    }
    const user = await requireSessionUser();
    const document = await getDocument(name, { tenantId: user.id, agentId: "jurist3-agent" });
    if (!document) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(document.buffer), {
      status: 200,
      headers: buildHeaders(document.fileName),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) return unauthorizedResponse();
    throw error;
  }
}
