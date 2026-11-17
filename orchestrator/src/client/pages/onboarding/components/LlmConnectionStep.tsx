import { AiAccountPanel } from "@client/components/ai-account/AiAccountPanel";
import type React from "react";
import type { ValidationState } from "../types";
import { InlineValidation } from "./InlineValidation";

export const LlmConnectionStep: React.FC<{
  validation: ValidationState;
  /** Re-checks the step after a sign-in, sign-out or switch of account. */
  onAccountChange: () => void;
}> = ({ validation, onAccountChange }) => (
  <div className="space-y-4">
    <AiAccountPanel onAccountChange={onAccountChange} />
    <InlineValidation
      state={validation}
      successMessage="Your AI account is connected."
    />
  </div>
);
