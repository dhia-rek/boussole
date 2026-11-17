import * as api from "@client/api";
import { useDemoInfo } from "@client/hooks/useDemoInfo";
import { useSettings } from "@client/hooks/useSettings";
import { isOnboardingComplete } from "@client/lib/onboarding";
import type { ValidationResult } from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const EMPTY_VALIDATION_STATE: ValidationResult & { checked: boolean } = {
  valid: false,
  message: null,
  checked: false,
};

export function useOnboardingRequirement() {
  const { settings, isLoading: settingsLoading } = useSettings();
  const demoInfo = useDemoInfo();
  const demoMode = demoInfo?.demoMode ?? false;

  const [llmValidation, setLlmValidation] = useState(EMPTY_VALIDATION_STATE);
  const [baseResumeValidation, setBaseResumeValidation] = useState(
    EMPTY_VALIDATION_STATE,
  );
  const validationInputsKeyRef = useRef<string | null>(null);

  const validationInputsKey = JSON.stringify({
    model: settings?.model?.value || null,
  });

  useEffect(() => {
    if (validationInputsKeyRef.current === validationInputsKey) {
      return;
    }
    validationInputsKeyRef.current = validationInputsKey;
    setLlmValidation(EMPTY_VALIDATION_STATE);
    setBaseResumeValidation(EMPTY_VALIDATION_STATE);
  }, [validationInputsKey]);

  const runValidations = useCallback(async () => {
    if (!settings) return;

    const validations: Promise<ValidationResult>[] = [];
    validations.push(
      api
        .validateLlm()
        .then((result) => {
          setLlmValidation({ ...result, checked: true });
          return result;
        })
        .catch((error: unknown) => {
          const result = {
            valid: false,
            message:
              error instanceof Error ? error.message : "LLM validation failed",
          };
          setLlmValidation({ ...result, checked: true });
          return result;
        }),
    );

    validations.push(
      api
        .validateResumeConfig()
        .then((result) => {
          setBaseResumeValidation({ ...result, checked: true });
          return result;
        })
        .catch((error: unknown) => {
          const result = {
            valid: false,
            message:
              error instanceof Error
                ? error.message
                : "Base resume validation failed",
          };
          setBaseResumeValidation({ ...result, checked: true });
          return result;
        }),
    );

    await Promise.allSettled(validations);
  }, [settings]);

  useEffect(() => {
    if (demoMode || !settings || settingsLoading) return;

    const needsValidation =
      !llmValidation.checked || !baseResumeValidation.checked;

    if (!needsValidation) return;
    void runValidations();
  }, [
    baseResumeValidation.checked,
    demoMode,
    llmValidation.checked,
    runValidations,
    settings,
    settingsLoading,
  ]);

  const complete = useMemo(() => {
    return isOnboardingComplete({
      demoMode,
      settings,
      llmValid: llmValidation.valid,
      baseResumeValid: baseResumeValidation.valid,
    });
  }, [baseResumeValidation.valid, demoMode, llmValidation.valid, settings]);

  const checking =
    !demoMode &&
    (settingsLoading ||
      !settings ||
      !llmValidation.checked ||
      !baseResumeValidation.checked);

  return {
    checking,
    complete,
  };
}
