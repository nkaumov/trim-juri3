import { ensureDb } from "./src/lib/db.ts";

const run = async () => {
  const db = await ensureDb();
  const tenant = process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID ?? "local-tenant";
  const agent = process.env.NEXT_PUBLIC_PLATFORM_AGENT_ID ?? "jurist3-agent";
  const contracts = await db.query("SELECT data FROM contracts_store WHERE tenant_id=$1 AND agent_id=$2", [tenant, agent]);
  const knowledge = await db.query("SELECT data FROM knowledge_store WHERE tenant_id=$1 AND agent_id=$2", [tenant, agent]);
  console.log(
    JSON.stringify(
      {
        tenant,
        agent,
        contracts: contracts.rows[0]?.data ?? null,
        knowledge: knowledge.rows[0]?.data ?? null,
      },
      null,
      2,
    ),
  );
  process.exit(0);
};

run();
