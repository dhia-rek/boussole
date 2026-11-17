import type { ValidationResult } from "@shared/types.js";

export type ValidationState = ValidationResult & {
  checked: boolean;
  hydrated: boolean;
};

export type OnboardingFormData = {
  searchTerms: string[];
  searchTermDraft: string;
  basicAuthUser: string;
  basicAuthPassword: string;
};

export type StepId = "llm" | "baseresume" | "searchterms" | "basicauth";
export type BasicAuthChoice = "enable" | "skip" | null;

export type OnboardingStep = {
  id: StepId;
  label: string;
  subtitle: string;
  complete: boolean;
  disabled: boolean;
};
