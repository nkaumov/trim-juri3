import type { Locale } from "@/i18n/types";

export type ContractStatus = "in_review" | "waiting" | "ready";

export type ContractCard = {
  id: string;
  title: string;
  updatedAt: string;
  status: ContractStatus;
};

export const mockContracts: ContractCard[] = [
  {
    id: "CNT-1042",
    title: "Поставка серверного оборудования",
    updatedAt: "10.04.2026 16:10",
    status: "in_review",
  },
  {
    id: "CNT-1039",
    title: "Лицензионный договор SaaS",
    updatedAt: "10.04.2026 15:42",
    status: "waiting",
  },
  {
    id: "CNT-1028",
    title: "Сервисное обслуживание",
    updatedAt: "10.04.2026 13:18",
    status: "ready",
  },
];

export function statusClass(status: ContractStatus): string {
  if (status === "ready") {
    return "ok";
  }

  if (status === "waiting") {
    return "warn";
  }

  return "bad";
}

export function localizedContractTitle(locale: Locale, value: string): string {
  if (locale === "ru") {
    return value;
  }

  const map: Record<string, string> = {
    "Поставка серверного оборудования": "Server hardware supply agreement",
    "Лицензионный договор SaaS": "SaaS license agreement",
    "Сервисное обслуживание": "Service maintenance agreement",
  };

  return map[value] ?? value;
}
