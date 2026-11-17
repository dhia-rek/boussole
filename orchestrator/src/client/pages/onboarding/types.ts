import type { ValidationResult } from "@shared/types.js";

export type ValidationState = ValidationResult & {
  checked: boolean;
  hydrated: boolean;
};

export type OnboardingFormData = {
  searchTerms: string[];
  searchTermDraft: string;
};

export type StepId = "llm" | "baseresume" | "searchterms";

export type OnboardingStep = {
  id: StepId;
  label: string;
  subtitle: string;
  complete: boolean;
  disabled: boolean;
};
