import { Pool } from "pg";

let pool: Pool | null = null;
let initPromise: Promise<void> | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function ensureDb(): Promise<Pool> {
  const pg = getPool();
  if (!initPromise) {
    initPromise = (async () => {
      await pg.query(`
        CREATE TABLE IF NOT EXISTS documents (
          id uuid PRIMARY KEY,
          tenant_id text NOT NULL,
          agent_id text NOT NULL,
          file_name text NOT NULL,
          mime_type text NOT NULL,
          data bytea NOT NULL,
          iv bytea,
          tag bytea,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await pg.query(`
        CREATE TABLE IF NOT EXISTS users (
          id uuid PRIMARY KEY,
          email text NOT NULL UNIQUE,
          password_hash text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await pg.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      if (process.env.CLEAR_SESSIONS_ON_START === "true") {
        await pg.query("DELETE FROM sessions");
      }
      await pg.query(`
        CREATE TABLE IF NOT EXISTS clients_store (
          tenant_id text NOT NULL,
          agent_id text NOT NULL,
          data jsonb NOT NULL DEFAULT '[]'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (tenant_id, agent_id)
        );
      `);
      await pg.query(`
        CREATE TABLE IF NOT EXISTS contracts_store (
          tenant_id text NOT NULL,
          agent_id text NOT NULL,
          data jsonb NOT NULL DEFAULT '[]'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (tenant_id, agent_id)
        );
      `);
      await pg.query(`
        CREATE TABLE IF NOT EXISTS knowledge_store (
          tenant_id text NOT NULL,
          agent_id text NOT NULL,
          data jsonb NOT NULL DEFAULT '[]'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (tenant_id, agent_id)
        );
      `);
      await pg.query(`
        CREATE TABLE IF NOT EXISTS profile_store (
          tenant_id text NOT NULL,
          agent_id text NOT NULL,
          data jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (tenant_id, agent_id)
        );
      `);
    })();
  }
  await initPromise;
  return pg;
}
