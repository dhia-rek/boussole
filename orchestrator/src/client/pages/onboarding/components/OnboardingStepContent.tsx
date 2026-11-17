import type { SearchTermsSuggestionResponse } from "@shared/types.js";
import type React from "react";
import type { BasicAuthChoice, StepId, ValidationState } from "../types";
import { BaseResumeStep } from "./BaseResumeStep";
import { BasicAuthStep } from "./BasicAuthStep";
import { LlmConnectionStep } from "./LlmConnectionStep";
import { SearchTermsStep } from "./SearchTermsStep";

export const OnboardingStepContent: React.FC<{
  baseResumeValidation: ValidationState;
  basicAuthChoice: BasicAuthChoice;
  basicAuthPassword: string;
  basicAuthUser: string;
  currentStep: StepId;
  isBusy: boolean;
  isImportingResume: boolean;
  isGeneratingSearchTerms: boolean;
  hasSavedSearchTermsInSession: boolean;
  llmValidation: ValidationState;
  searchTermDraft: string;
  searchTerms: string[];
  searchTermsSource: SearchTermsSuggestionResponse["source"] | null;
  searchTermsStale: boolean;
  onAiAccountChange: () => void;
  onBasicAuthChoiceChange: (choice: BasicAuthChoice) => void;
  onBasicAuthPasswordChange: (value: string) => void;
  onBasicAuthUserChange: (value: string) => void;
  onImportResumeFile: (file: File) => Promise<void>;
  onRegenerateSearchTerms: () => Promise<void>;
  onSearchTermDraftChange: (value: string) => void;
  onSearchTermsChange: (values: string[]) => void;
}> = (props) => {
  if (props.currentStep === "llm") {
    return (
      <LlmConnectionStep
        validation={props.llmValidation}
        onAccountChange={props.onAiAccountChange}
      />
    );
  }

  if (props.currentStep === "baseresume") {
    return (
      <BaseResumeStep
        baseResumeValidation={props.baseResumeValidation}
        isBusy={props.isBusy}
        isImportingResume={props.isImportingResume}
        onImportResumeFile={props.onImportResumeFile}
      />
    );
  }

  if (props.currentStep === "searchterms") {
    return (
      <SearchTermsStep
        hasSavedSearchTermsInSession={props.hasSavedSearchTermsInSession}
        isBusy={props.isBusy}
        isGeneratingSearchTerms={props.isGeneratingSearchTerms}
        searchTermDraft={props.searchTermDraft}
        searchTerms={props.searchTerms}
        searchTermsSource={props.searchTermsSource}
        searchTermsStale={props.searchTermsStale}
        onRegenerate={props.onRegenerateSearchTerms}
        onSearchTermDraftChange={props.onSearchTermDraftChange}
        onSearchTermsChange={props.onSearchTermsChange}
      />
    );
  }

  return (
    <BasicAuthStep
      basicAuthChoice={props.basicAuthChoice}
      basicAuthPassword={props.basicAuthPassword}
      basicAuthUser={props.basicAuthUser}
      isBusy={props.isBusy}
      onBasicAuthChoiceChange={props.onBasicAuthChoiceChange}
      onBasicAuthPasswordChange={props.onBasicAuthPasswordChange}
      onBasicAuthUserChange={props.onBasicAuthUserChange}
    />
  );
};
