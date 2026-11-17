import { ClaudeModelField } from "@client/components/ClaudeModelField";
import type React from "react";
import type { ValidationState } from "../types";
import { InlineValidation } from "./InlineValidation";

export const LlmConnectionStep: React.FC<{
  defaultModel: string | null | undefined;
  effectiveModel: string | null | undefined;
  isBusy: boolean;
  model: string;
  validation: ValidationState;
  onModelChange: (value: string) => void;
}> = ({
  defaultModel,
  effectiveModel,
  isBusy,
  model,
  validation,
  onModelChange,
}) => (
  <ClaudeModelField
    value={model}
    onChange={onModelChange}
    effectiveModel={effectiveModel}
    defaultModel={defaultModel}
    disabled={isBusy}
    validationSlot={
      <InlineValidation
        state={validation}
        successMessage="Claude is connected."
      />
    }
  />
);
