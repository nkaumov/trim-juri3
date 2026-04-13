import crypto from "node:crypto";

function getSigningKey(): Buffer {
  const raw = process.env.DOCUMENTS_SIGNING_KEY || process.env.DOCUMENTS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("DOCUMENTS_SIGNING_KEY is not configured");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length < 32) {
    throw new Error("DOCUMENTS_SIGNING_KEY must be at least 32 bytes base64");
  }
  return key;
}

export function signDocumentId(docId: string, expiresAt: number): string {
  const key = getSigningKey();
  const data = `${docId}.${expiresAt}`;
  const sig = crypto.createHmac("sha256", key).update(data).digest("hex");
  return sig;
}

export function verifyDocumentToken(docId: string, expiresAt: number, token: string): boolean {
  if (!docId || !token || !expiresAt) {
    return false;
  }
  if (Date.now() > expiresAt) {
    return false;
  }
  const expected = signDocumentId(docId, expiresAt);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}
