import type {
  ChatStyleLanguageMode,
  ChatStyleManualLanguage,
} from "@shared/types.js";

export type EffectiveDefault<T> = {
  effective: T;
  default: T;
};

export type ModelValues = EffectiveDefault<string>;

export type WebhookValues = EffectiveDefault<string>;
export type DisplayValues = {
  renderMarkdownInJobDescriptions: EffectiveDefault<boolean>;
};
export type ChatValues = {
  tone: EffectiveDefault<string>;
  formality: EffectiveDefault<string>;
  constraints: EffectiveDefault<string>;
  doNotUse: EffectiveDefault<string>;
  languageMode: EffectiveDefault<ChatStyleLanguageMode>;
  manualLanguage: EffectiveDefault<ChatStyleManualLanguage>;
  stopSlopEnabled: EffectiveDefault<boolean>;
  summaryMaxWords: EffectiveDefault<number | null>;
  maxKeywordsPerSkill: EffectiveDefault<number | null>;
};

export type EnvSettingsValues = {
  readable: {
    adzunaAppId: string;
    basicAuthUser: string;
    basicAuthPassword: string;
  };
  private: {
    adzunaAppKeyHint: string | null;
    basicAuthPasswordHint: string | null;
    webhookSecretHint: string | null;
  };
  basicAuthActive: boolean;
};

export type BackupValues = {
  backupEnabled: EffectiveDefault<boolean>;
  backupHour: EffectiveDefault<number>;
  backupMaxCount: EffectiveDefault<number>;
};

export type ScoringValues = {
  penalizeMissingSalary: EffectiveDefault<boolean>;
  missingSalaryPenalty: EffectiveDefault<number>;
  autoSkipScoreThreshold: EffectiveDefault<number | null>;
  blockedCompanyKeywords: EffectiveDefault<string[]>;
  scoringInstructions: EffectiveDefault<string>;
};

export type PromptTemplatesValues = {
  ghostwriterSystemPromptTemplate: EffectiveDefault<string>;
  tailoringPromptTemplate: EffectiveDefault<string>;
  scoringPromptTemplate: EffectiveDefault<string>;
};
