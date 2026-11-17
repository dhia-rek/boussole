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
    title: "Connect Claude.",
    description:
      "Boussole runs every AI step on Claude through the Claude Code CLI, with your Claude subscription. Check that it is signed in on this computer and pick the model.",
  },
  baseresume: {
    eyebrow: "Step 2",
    title: "Import your current CV.",
    description:
      "Upload your CV as a PDF or DOCX. Claude reads it and creates your CV in the CV editor, where you can check and edit every section.",
  },
  searchterms: {
    eyebrow: "Step 3",
    title: "Choose the job titles to search for.",
    description:
      "Start from titles generated from your current resume, then edit the list so Boussole searches for the roles you actually want next.",
  },
  basicauth: {
    eyebrow: "Step 4",
    title: "Secure your workspace",
    description:
      "Add a username and password so only signed-in users can access protected parts of Boussole. You can always set this up later in Settings.",
  },
};
