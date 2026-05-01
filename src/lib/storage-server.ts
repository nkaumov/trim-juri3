import { ensureDb } from "@/lib/db";

export type StorageScope = {
  tenantId: string;
  agentId: string;
};

type TableName = "clients_store" | "contracts_store" | "knowledge_store" | "analysis_store";

export async function getStore<T>(table: TableName, scope: StorageScope): Promise<T> {
  const db = await ensureDb();
  const result = await db.query(
    `SELECT data FROM ${table} WHERE tenant_id = $1 AND agent_id = $2`,
    [scope.tenantId, scope.agentId],
  );
  if (result.rowCount === 0) {
    return [] as T;
  }
  return result.rows[0].data as T;
}

export async function setStore<T>(table: TableName, scope: StorageScope, data: T): Promise<void> {
  const db = await ensureDb();
  const payload = JSON.stringify(data ?? []);
  await db.query(
    `INSERT INTO ${table} (tenant_id, agent_id, data, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (tenant_id, agent_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [scope.tenantId, scope.agentId, payload],
  );
}
