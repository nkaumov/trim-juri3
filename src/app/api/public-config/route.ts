import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type PublicConfig = {
  platformTenantId: string;
  platformAgentId: string;
  onlyofficeUrl: string;
  onlyofficeFileBaseUrl: string;
};

export async function GET() {
  const readEnv = (key: string): string | undefined => process.env[key];

  const config: PublicConfig = {
    platformTenantId:
      process.env.PLATFORM_TENANT_ID ?? readEnv("NEXT_PUBLIC_PLATFORM_TENANT_ID") ?? "local-tenant",
    platformAgentId:
      process.env.PLATFORM_AGENT_ID ?? readEnv("NEXT_PUBLIC_PLATFORM_AGENT_ID") ?? "jurist3-agent",
    onlyofficeUrl: process.env.ONLYOFFICE_URL ?? readEnv("NEXT_PUBLIC_ONLYOFFICE_URL") ?? "",
    onlyofficeFileBaseUrl:
      process.env.ONLYOFFICE_FILE_BASE_URL ?? readEnv("NEXT_PUBLIC_ONLYOFFICE_FILE_BASE_URL") ?? "",
  };
  return NextResponse.json(config);
}
