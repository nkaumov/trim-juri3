import crypto from "node:crypto";
import { ensureDb } from "@/lib/db";

type DocumentRecord = {
  id: string;
  tenantId: string;
  agentId: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
  iv: Buffer | null;
  tag: Buffer | null;
};

function getEncryptionKey(): Buffer | null {
  const raw = process.env.DOCUMENTS_ENCRYPTION_KEY;
  if (!raw) {
    return null;
  }
  try {
    const buf = Buffer.from(raw, "base64");
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

function encryptBuffer(buffer: Buffer): { data: Buffer; iv: Buffer | null; tag: Buffer | null } {
  const key = getEncryptionKey();
  if (!key) {
    return { data: buffer, iv: null, tag: null };
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { data: encrypted, iv, tag };
}

function decryptBuffer(record: DocumentRecord): Buffer {
  if (!record.iv || !record.tag) {
    return record.data;
  }
  const key = getEncryptionKey();
  if (!key) {
    throw new Error("DOCUMENTS_ENCRYPTION_KEY is required to decrypt documents");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, record.iv);
  decipher.setAuthTag(record.tag);
  return Buffer.concat([decipher.update(record.data), decipher.final()]);
}

export async function saveDocument(input: {
  tenantId: string;
  agentId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<string> {
  const db = await ensureDb();
  const id = crypto.randomUUID();
  const encrypted = encryptBuffer(input.buffer);
  await db.query(
    `INSERT INTO documents (id, tenant_id, agent_id, file_name, mime_type, data, iv, tag)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      input.tenantId,
      input.agentId,
      input.fileName,
      input.mimeType,
      encrypted.data,
      encrypted.iv,
      encrypted.tag,
    ],
  );
  return id;
}

export async function getDocument(
  id: string,
  scope?: { tenantId: string; agentId: string },
): Promise<{
  fileName: string;
  mimeType: string;
  buffer: Buffer;
} | null> {
  const db = await ensureDb();
  const result = scope
    ? await db.query(
        `SELECT id,
                tenant_id as "tenantId",
                agent_id as "agentId",
                file_name as "fileName",
                mime_type as "mimeType",
                data, iv, tag
         FROM documents WHERE id = $1 AND tenant_id = $2 AND agent_id = $3`,
        [id, scope.tenantId, scope.agentId],
      )
    : await db.query(
        `SELECT id,
                tenant_id as "tenantId",
                agent_id as "agentId",
                file_name as "fileName",
                mime_type as "mimeType",
                data, iv, tag
         FROM documents WHERE id = $1`,
        [id],
      );
  if (result.rowCount === 0) {
    return null;
  }
  const row = result.rows[0] as DocumentRecord;
  const buffer = decryptBuffer(row);
  return {
    fileName: row.fileName,
    mimeType: row.mimeType,
    buffer,
  };
}

export async function updateDocument(input: {
  id: string;
  tenantId: string;
  agentId: string;
  fileName?: string;
  mimeType?: string;
  buffer: Buffer;
}): Promise<void> {
  const db = await ensureDb();
  const encrypted = encryptBuffer(input.buffer);
  await db.query(
    `UPDATE documents
     SET file_name = COALESCE($4, file_name),
         mime_type = COALESCE($5, mime_type),
         data = $6,
         iv = $7,
         tag = $8
     WHERE id = $1 AND tenant_id = $2 AND agent_id = $3`,
    [
      input.id,
      input.tenantId,
      input.agentId,
      input.fileName ?? null,
      input.mimeType ?? null,
      encrypted.data,
      encrypted.iv,
      encrypted.tag,
    ],
  );
}
