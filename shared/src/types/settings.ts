import type {
  LocationMatchStrictness,
  LocationSearchScope,
} from "../location-preferences";
import type { AiProvider } from "./ai-account";
import type { DesignResumeAiGuidance } from "./design-resume";

export interface ResumeProjectCatalogItem {
  id: string;
  name: string;
  description: string;
  date: string;
  isVisibleInBase: boolean;
}

export interface ResumeProjectsSettings {
  maxProjects: number;
  lockedProjectIds: string[];
  aiSelectableProjectIds: string[];
}

export const CHAT_STYLE_LANGUAGE_MODE_VALUES = [
  "manual",
  "match-resume",
] as const;

export type ChatStyleLanguageMode =
  (typeof CHAT_STYLE_LANGUAGE_MODE_VALUES)[number];

export const CHAT_STYLE_MANUAL_LANGUAGE_VALUES = [
  "english",
  "german",
  "french",
  "spanish",
] as const;

export type ChatStyleManualLanguage =
  (typeof CHAT_STYLE_MANUAL_LANGUAGE_VALUES)[number];

export const CHAT_STYLE_MANUAL_LANGUAGE_LABELS: Record<
  ChatStyleManualLanguage,
  string
> = {
  english: "English",
  german: "German",
  french: "French",
  spanish: "Spanish",
};

export interface ResumeProfile {
  basics?: {
    name?: string;
    label?: string;
    image?: string;
    email?: string;
    phone?: string;
    url?: string;
    summary?: string;
    headline?: string;
    location?: {
      address?: string;
      postalCode?: string;
      city?: string;
      countryCode?: string;
      region?: string;
    };
    profiles?: Array<{
      network?: string;
      username?: string;
      url?: string;
    }>;
  };
  sections?: {
    summary?: {
      id?: string;
      visible?: boolean;
      name?: string;
      content?: string;
    };
    skills?: {
      id?: string;
      visible?: boolean;
      name?: string;
      items?: Array<{
        id: string;
        name: string;
        description: string;
        level: number;
        keywords: string[];
        visible: boolean;
      }>;
    };
    projects?: {
      id?: string;
      visible?: boolean;
      name?: string;
      items?: Array<{
        id: string;
        name: string;
        description: string;
        date: string;
        summary: string;
        visible: boolean;
        keywords?: string[];
        url?: string;
      }>;
    };
    experience?: {
      id?: string;
      visible?: boolean;
      name?: string;
      items?: Array<{
        id: string;
        company: string;
        position: string;
        location: string;
        date: string;
        summary: string;
        visible: boolean;
      }>;
    };
    [key: string]: unknown;
  };
  /** Candidate-authored AI guidance (Design Resume only). */
  aiGuidance?: DesignResumeAiGuidance;
  /** Language tag of the CV variant this profile was built from. */
  language?: string;
  [key: string]: unknown;
}

export interface ProfileStatusResponse {
  exists: boolean;
  error: string | null;
}

export interface ValidationResult {
  valid: boolean;
  message: string | null;
  status?: number | null;
}

export interface SearchTermsSuggestionResponse {
  terms: string[];
  source: "ai" | "fallback";
}

export interface DemoInfoResponse {
  demoMode: boolean;
  resetCadenceHours: number;
  lastResetAt: string | null;
  nextResetAt: string | null;
  baselineVersion: string | null;
  baselineName: string | null;
}

export type Resolved<T> = { value: T; default: T; override: T | null };

export interface AppSettings {
  // Typed settings (Resolved):
  aiProvider: Resolved<AiProvider>;
  model: Resolved<string>;
  chatgptModel: Resolved<string>;
  pipelineWebhookUrl: Resolved<string>;
  jobCompleteWebhookUrl: Resolved<string>;
  resumeProjects: Resolved<ResumeProjectsSettings>;
  adzunaMaxJobsPerTerm: Resolved<number>;
  startupjobsMaxJobsPerTerm: Resolved<number>;
  searchTerms: Resolved<string[]>;
  workplaceTypes: Resolved<Array<"remote" | "hybrid" | "onsite">>;
  blockedCompanyKeywords: Resolved<string[]>;
  scoringInstructions: Resolved<string>;
  ghostwriterSystemPromptTemplate: Resolved<string>;
  ghostwriterStopSlopEnabled: Resolved<boolean>;
  tailoringPromptTemplate: Resolved<string>;
  scoringPromptTemplate: Resolved<string>;
  searchCities: Resolved<string>;
  locationSearchScope: Resolved<LocationSearchScope>;
  locationMatchStrictness: Resolved<LocationMatchStrictness>;
  jobspyResultsWanted: Resolved<number>;
  jobspyCountryIndeed: Resolved<string>;
  renderMarkdownInJobDescriptions: Resolved<boolean>;
  chatStyleTone: Resolved<string>;
  chatStyleFormality: Resolved<string>;
  chatStyleConstraints: Resolved<string>;
  chatStyleDoNotUse: Resolved<string>;
  chatStyleLanguageMode: Resolved<ChatStyleLanguageMode>;
  chatStyleManualLanguage: Resolved<ChatStyleManualLanguage>;
  chatStyleSummaryMaxWords: Resolved<number | null>;
  chatStyleMaxKeywordsPerSkill: Resolved<number | null>;
  backupEnabled: Resolved<boolean>;
  backupHour: Resolved<number>;
  backupMaxCount: Resolved<number>;
  penalizeMissingSalary: Resolved<boolean>;
  missingSalaryPenalty: Resolved<number>;
  autoSkipScoreThreshold: Resolved<number | null>;

  onboardingBasicAuthDecision: "enabled" | "skipped" | null;
  adzunaAppId: string | null;
  basicAuthUser: string | null;
  basicAuthPassword: string | null;

  adzunaAppKeyHint: string | null;
  basicAuthPasswordHint: string | null;
  webhookSecretHint: string | null;
  notionApiKeyHint: string | null;
  hunterApiKeyHint: string | null;

  // Non-secret overrides surfaced directly:
  notionDatabaseId: string | null;

  // Computed:
  basicAuthActive: boolean;
  profileProjects: ResumeProjectCatalogItem[];
}
