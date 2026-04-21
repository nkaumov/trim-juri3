import type { ContractDraft } from "@/lib/contracts/types";

import { randomId } from "@/lib/uuid";

export const contractsStorageKey = "jurist3.contracts.v1";

export function loadContracts(): ContractDraft[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(contractsStorageKey);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as ContractDraft[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    const normalized: ContractDraft[] = parsed.map((item) => {
      const sourceIterations = Array.isArray(item.iterations) ? item.iterations : [];
      const normalizedIterations =
        sourceIterations.length > 0
          ? sourceIterations.map((iteration, index) => {
              if (index === 0) {
                return {
                  ...iteration,
                  title: "Договор создан",
                  kind: "created" as const,
                };
              }

              return iteration;
            })
          : [
              {
                id: randomId(),
                title: "Договор создан",
                content:
                  `Шаблон договора: ${item.templateName}\n\n` +
                  "Исходная версия создана на основе выбранного шаблона.",
                updatedAt: item.createdAt ?? new Date().toISOString(),
                kind: "created" as const,
              },
            ];

      return {
        ...item,
        status: (item.status === "finalized"
          ? "finalized"
          : item.status === "archived"
            ? "archived"
            : "draft") as ContractDraft["status"],
        iterations: normalizedIterations,
      };
    });

    window.localStorage.setItem(contractsStorageKey, JSON.stringify(normalized));
    return normalized;
  } catch {
    window.localStorage.removeItem(contractsStorageKey);
    return [];
  }
}

export function saveContracts(contracts: ContractDraft[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(contractsStorageKey, JSON.stringify(contracts));
}
