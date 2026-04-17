import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type PublicConfig = {
  platformTenantId: string;
  platformAgentId: string;
  onlyofficeUrl: string;
  onlyofficeFileBaseUrl: string;
};

export async function GET() {
  const config: PublicConfig = {
    platformTenantId: process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID ?? "local-tenant",
    platformAgentId: process.env.NEXT_PUBLIC_PLATFORM_AGENT_ID ?? "jurist3-agent",
    onlyofficeUrl: process.env.NEXT_PUBLIC_ONLYOFFICE_URL ?? "",
    onlyofficeFileBaseUrl: process.env.NEXT_PUBLIC_ONLYOFFICE_FILE_BASE_URL ?? "",
  };
  return NextResponse.json(config);
}

