import type { StepId, ValidationState } from "./types";

export const EMPTY_VALIDATION_STATE: ValidationState = {
  valid: false,
  message: null,
  checked: false,
  hydrated: false,
};

export const STEP_COPY: Record<
  StepId,
  {
    eyebrow: string;
    title: string;
    description: string;
  }
> = {
  llm: {
    eyebrow: "Step 1",
    title: "Connect your AI",
    description:
      "Boussole scores jobs, tailors your CV and writes cover letters with your own Claude or ChatGPT account. Sign in with the one you use, then pick its model.",
  },
  baseresume: {
    eyebrow: "Step 2",
    title: "Import your current CV.",
    description:
      "Upload your CV as a PDF or DOCX. Your AI reads it and creates your CV in the CV editor, where you can check and edit every section.",
  },
  searchterms: {
    eyebrow: "Step 3",
    title: "Choose the job titles to search for.",
    description:
      "Start from titles generated from your current resume, then edit the list so Boussole searches for the roles you actually want next.",
  },
};
