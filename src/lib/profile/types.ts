export type GoogleDocsIntegration = {
  enabled: boolean;
  driveFolderId: string;
  credentialsJson: string;
};

export type GmailIntegration = {
  enabled: boolean;
  fromEmail: string;
  appPassword: string;
  smtpHost: string;
  smtpPort: string;
};

export type CompanyAutofillProfile = {
  legalName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  signerName: string;
  signerRole: string;
  legalAddress: string;
};

export type ProfileSettings = {
  googleDocs: GoogleDocsIntegration;
  gmail: GmailIntegration;
  companyAutofill: CompanyAutofillProfile;
};
