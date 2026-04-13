import sidebarRu from "@/i18n/locales/ru/sidebar.json";
import workspaceRu from "@/i18n/locales/ru/workspace.json";
import settingsRu from "@/i18n/locales/ru/settings.json";
import sidebarEn from "@/i18n/locales/en/sidebar.json";
import workspaceEn from "@/i18n/locales/en/workspace.json";
import settingsEn from "@/i18n/locales/en/settings.json";
import type { Dictionary, Locale, Namespace } from "@/i18n/types";

const dictionaries: Record<Locale, Dictionary> = {
  ru: {
    sidebar: sidebarRu,
    workspace: workspaceRu,
    settings: settingsRu,
  },
  en: {
    sidebar: sidebarEn,
    workspace: workspaceEn,
    settings: settingsEn,
  },
};

export function t(locale: Locale, key: `${Namespace}.${string}`): string {
  const [namespace, ...tokenParts] = key.split(".");
  const token = tokenParts.join(".");
  const localeDict = dictionaries[locale] ?? dictionaries.ru;
  const value = localeDict[namespace as Namespace]?.[token];

  if (value) {
    return value;
  }

  return dictionaries.ru[namespace as Namespace]?.[token] ?? key;
}
