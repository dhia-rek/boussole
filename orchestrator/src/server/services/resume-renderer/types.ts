import type { ChatStyleManualLanguage } from "@shared/types";

export interface LatexResumeContactItem {
  text: string;
  url?: string | null;
  /** Explicit icon name (e.g. "calendar", "map-pin"); inferred when absent. */
  icon?: string | null;
  /** Custom basics fields (availability, …) render on their own header line. */
  kind?: "custom";
}

export interface LatexResumeEntry {
  title: string;
  subtitle?: string | null;
  secondaryTitle?: string | null;
  secondarySubtitle?: string | null;
  date?: string | null;
  bullets: string[];
  url?: string | null;
  linkLabel?: string | null;
}

export interface LatexResumeSkillGroup {
  name: string;
  keywords: string[];
}

export interface LatexResumeSectionTitles {
  summary: string;
  experience: string;
  education: string;
  projects: string;
  skills: string;
  certifications: string;
  awards: string;
  publications: string;
  volunteer: string;
  languages: string;
  interests: string;
  other: string;
}

export interface LatexResumeExtraSection {
  title: string;
  /** certifications | awards | publications | volunteer | custom */
  kind?: string;
  entries: LatexResumeEntry[];
}

export interface LatexResumeDocument {
  name: string;
  headline?: string | null;
  contactItems: LatexResumeContactItem[];
  summary?: string | null;
  experience: LatexResumeEntry[];
  education: LatexResumeEntry[];
  projects: LatexResumeEntry[];
  skillGroups: LatexResumeSkillGroup[];
  languages?: string[];
  interests?: string[];
  extraSections?: LatexResumeExtraSection[];
  sectionTitles?: LatexResumeSectionTitles;
}

export interface RenderResumePdfArgs {
  document: LatexResumeDocument;
  outputPath: string;
  jobId: string;
}

export interface ResumeRenderer {
  render(args: RenderResumePdfArgs): Promise<void>;
}

export interface NormalizeResumeJsonToLatexDocumentOptions {
  language?: ChatStyleManualLanguage;
}
