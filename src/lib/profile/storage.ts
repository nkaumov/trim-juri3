import type { KnowledgeScope } from "@/lib/knowledge/types";
import type { ProfileSettings } from "@/lib/profile/types";

const storagePrefix = "jurist3.profile.v1";

function storageKey(scope: KnowledgeScope): string {
  return `${storagePrefix}:${scope.tenantId}:${scope.agentId}`;
}

export function defaultProfileSettings(): ProfileSettings {
  return {
    googleDocs: {
      enabled: false,
      driveFolderId: "",
      credentialsJson: "",
    },
    gmail: {
      enabled: false,
      fromEmail: "",
      appPassword: "",
      smtpHost: "smtp.gmail.com",
      smtpPort: "465",
    },
    companyAutofill: {
      legalName: "",
      inn: "",
      kpp: "",
      ogrn: "",
      signerName: "",
      signerRole: "",
      legalAddress: "",
    },
  };
}

export function loadProfileSettings(scope: KnowledgeScope): ProfileSettings {
  if (typeof window === "undefined") {
    return defaultProfileSettings();
  }

  const raw = window.localStorage.getItem(storageKey(scope));
  if (!raw) {
    return defaultProfileSettings();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ProfileSettings> & {
      googleSheets?: {
        enabled?: boolean;
        spreadsheetId?: string;
        credentialsJson?: string;
      };
    };
    const defaults = defaultProfileSettings();
    const legacySheets = parsed.googleSheets;

    return {
      googleDocs: {
        ...defaults.googleDocs,
        ...parsed.googleDocs,
        ...(legacySheets
          ? {
              enabled: legacySheets.enabled ?? defaults.googleDocs.enabled,
              driveFolderId: legacySheets.spreadsheetId ?? defaults.googleDocs.driveFolderId,
              credentialsJson: legacySheets.credentialsJson ?? defaults.googleDocs.credentialsJson,
            }
          : {}),
      },
      gmail: {
        ...defaults.gmail,
        ...parsed.gmail,
      },
      companyAutofill: {
        ...defaults.companyAutofill,
        ...parsed.companyAutofill,
      },
    };
  } catch {
    window.localStorage.removeItem(storageKey(scope));
    return defaultProfileSettings();
  }
}

export function saveProfileSettings(scope: KnowledgeScope, value: ProfileSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey(scope), JSON.stringify(value));
}
