import * as api from "@client/api";
import { fileToDataUrl } from "@client/components/design-resume/utils";
import { useDemoInfo } from "@client/hooks/useDemoInfo";
import { useSettings } from "@client/hooks/useSettings";
import { isOnboardingComplete } from "@client/lib/onboarding";
import { queryKeys } from "@client/lib/queryKeys";
import type {
  AppSettings,
  SearchTermsSuggestionResponse,
  ValidationResult,
} from "@shared/types.js";
import { normalizeSearchTerms } from "@shared/utils/search-terms";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { formatUserFacingError } from "@/client/lib/error-format";
import { showErrorToast } from "@/client/lib/error-toast";
import { EMPTY_VALIDATION_STATE, STEP_COPY } from "./content";
import type {
  OnboardingFormData,
  OnboardingStep,
  StepId,
  ValidationState,
} from "./types";

export function useOnboardingFlow() {
  const queryClient = useQueryClient();
  const { settings, isLoading: settingsLoading } = useSettings();
  const demoInfo = useDemoInfo();
  const demoMode = demoInfo?.demoMode ?? false;

  const [isSaving, setIsSaving] = useState(false);
  const [isValidatingLlm, setIsValidatingLlm] = useState(false);
  const [isValidatingBaseResume, setIsValidatingBaseResume] = useState(false);
  const [isImportingResume, setIsImportingResume] = useState(false);
  const [isGeneratingSearchTerms, setIsGeneratingSearchTerms] = useState(false);
  const [llmValidation, setLlmValidation] = useState<ValidationState>(
    EMPTY_VALIDATION_STATE,
  );
  const [baseResumeValidation, setBaseResumeValidation] =
    useState<ValidationState>(EMPTY_VALIDATION_STATE);
  const [searchTermsSaved, setSearchTermsSaved] = useState(false);
  const [hasSavedSearchTermsInSession, setHasSavedSearchTermsInSession] =
    useState(false);
  const [searchTermsSource, setSearchTermsSource] = useState<
    SearchTermsSuggestionResponse["source"] | null
  >(null);
  const [searchTermsStale, setSearchTermsStale] = useState(false);
  const [currentStep, setCurrentStep] = useState<StepId | null>(null);
  const searchTermsOverrideKeyRef = useRef<string | null>(null);
  const autoSuggestionAttemptedRef = useRef(false);

  const { control, getValues, reset, setValue, watch } =
    useForm<OnboardingFormData>({
      defaultValues: {
        searchTerms: [],
        searchTermDraft: "",
      },
    });

  const syncSettingsCache = useCallback(
    (nextSettings: AppSettings) => {
      queryClient.setQueryData(queryKeys.settings.current(), nextSettings);
    },
    [queryClient],
  );

  useEffect(() => {
    if (!settings) return;

    const searchTermsOverride = settings.searchTerms?.override ?? null;
    const hasExplicitSearchTermsOverride =
      Array.isArray(searchTermsOverride) && searchTermsOverride.length > 0;
    const searchTermsOverrideKey = JSON.stringify(searchTermsOverride);
    setLlmValidation(EMPTY_VALIDATION_STATE);
    setBaseResumeValidation(EMPTY_VALIDATION_STATE);
    reset({
      searchTerms: settings.searchTerms?.value ?? [],
      searchTermDraft: "",
    });
    if (searchTermsOverrideKeyRef.current !== searchTermsOverrideKey) {
      searchTermsOverrideKeyRef.current = searchTermsOverrideKey;
      setSearchTermsSaved(hasExplicitSearchTermsOverride);
      setHasSavedSearchTermsInSession(hasExplicitSearchTermsOverride);
      setSearchTermsSource(null);
      setSearchTermsStale(false);
      autoSuggestionAttemptedRef.current = hasExplicitSearchTermsOverride;
    }
  }, [reset, settings]);

  const llmValidated = llmValidation.valid;
  const searchTermsOverride = settings?.searchTerms?.override ?? null;
  const hasExplicitSearchTermsOverride = Boolean(
    Array.isArray(searchTermsOverride) && searchTermsOverride.length > 0,
  );
  const searchTermsComplete = searchTermsSaved && !searchTermsStale;

  const toValidationState = useCallback(
    (
      result: ValidationResult,
      options?: {
        markChecked?: boolean;
      },
    ): ValidationState => ({
      ...result,
      checked: options?.markChecked ?? true,
      hydrated: true,
    }),
    [],
  );

  const validateLlm = useCallback(
    async (options?: { markChecked?: boolean }) => {
      setIsValidatingLlm(true);
      try {
        const result = await api.validateLlm();
        setLlmValidation(toValidationState(result, options));
        return result;
      } catch (error) {
        const result = {
          valid: false,
          message: formatUserFacingError(
            error,
            "Could not check your AI account",
          ),
        };
        setLlmValidation(toValidationState(result, options));
        return result;
      } finally {
        setIsValidatingLlm(false);
      }
    },
    [toValidationState],
  );

  const validateBaseResume = useCallback(
    async (options?: { markChecked?: boolean }) => {
      setIsValidatingBaseResume(true);
      try {
        const result = await api.validateResumeConfig();
        setBaseResumeValidation(toValidationState(result, options));
        return result;
      } catch (error) {
        const result = {
          valid: false,
          message:
            error instanceof Error
              ? error.message
              : "Base resume validation failed",
        };
        setBaseResumeValidation(toValidationState(result, options));
        return result;
      } finally {
        setIsValidatingBaseResume(false);
      }
    },
    [toValidationState],
  );

  const runAllValidations = useCallback(async () => {
    if (!settings || demoMode) return;

    const validations: Promise<ValidationResult>[] = [
      validateLlm({ markChecked: false }),
      validateBaseResume({ markChecked: false }),
    ];
    await Promise.allSettled(validations);
  }, [demoMode, settings, validateBaseResume, validateLlm]);

  useEffect(() => {
    if (demoMode || !settings || settingsLoading) return;

    const needsValidation =
      !llmValidation.hydrated || !baseResumeValidation.hydrated;
    if (!needsValidation) return;

    void runAllValidations();
  }, [
    baseResumeValidation.hydrated,
    demoMode,
    llmValidation.hydrated,
    runAllValidations,
    settings,
    settingsLoading,
  ]);

  const steps = useMemo<OnboardingStep[]>(
    () => [
      {
        id: "llm",
        label: "AI account",
        subtitle: "Sign in with Claude or ChatGPT",
        complete: llmValidated,
        disabled: false,
      },
      {
        id: "baseresume",
        label: "CV",
        subtitle: "Upload your CV (PDF or DOCX)",
        complete: baseResumeValidation.valid,
        disabled: false,
      },
      {
        id: "searchterms",
        label: "Search terms",
        subtitle: "Titles to search for",
        complete: searchTermsComplete,
        disabled: false,
      },
    ],
    [baseResumeValidation.valid, llmValidated, searchTermsComplete],
  );

  useEffect(() => {
    if (!steps.length) return;

    setCurrentStep((existing) => {
      if (!existing) return steps[0].id;
      const existingStep = steps.find((step) => step.id === existing);
      if (!existingStep) return steps[0].id;
      return existing;
    });
  }, [steps]);

  const progressValue =
    steps.length > 0
      ? Math.round(
          (steps.filter((step) => step.complete).length / steps.length) * 100,
        )
      : 0;

  const complete = isOnboardingComplete({
    demoMode,
    settings,
    llmValid: llmValidated,
    baseResumeValid: baseResumeValidation.valid,
    searchTermsValid: searchTermsComplete,
  });

  /** "Continue" on a step that is already done: open the next one. */
  const goToNextStep = useCallback(() => {
    const index = steps.findIndex((step) => step.id === currentStep);
    const next = index >= 0 ? steps[index + 1] : undefined;
    if (next) setCurrentStep(next.id);
    return settings ?? null;
  }, [currentStep, settings, steps]);

  // The AI account panel saves the account and model itself; this step
  // only checks that the chosen account is signed in.
  const handleLlmStep = useCallback(async () => {
    if (llmValidated) return goToNextStep();

    const validation = await validateLlm();
    if (!validation.valid) {
      toast.error(validation.message || "Your AI account is not connected yet");
      return null;
    }

    toast.success("Your AI account is connected");
    return settings ?? null;
  }, [goToNextStep, llmValidated, settings, validateLlm]);

  const handleAiAccountChange = useCallback(() => {
    void validateLlm();
  }, [validateLlm]);

  const markSearchTermsStale = useCallback(() => {
    const currentTerms = getValues().searchTerms;
    if (currentTerms.length === 0 && !hasSavedSearchTermsInSession) return;
    setSearchTermsSaved(false);
    setSearchTermsStale(true);
    setSearchTermsSource(null);
  }, [getValues, hasSavedSearchTermsInSession]);

  const handleGenerateSearchTerms = useCallback(
    async (options?: { showToast?: boolean }) => {
      try {
        setIsGeneratingSearchTerms(true);
        const result = await api.suggestOnboardingSearchTerms();
        setValue("searchTerms", result.terms, { shouldDirty: true });
        setValue("searchTermDraft", "");
        setSearchTermsSaved(false);
        setSearchTermsSource(result.source);
        setSearchTermsStale(false);

        if (options?.showToast) {
          toast.success("Search terms refreshed", {
            description:
              result.source === "ai"
                ? "Job titles were generated from your current resume."
                : "Job titles were refreshed from a simpler resume-based fallback.",
          });
        }

        return result;
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to suggest search terms",
        );
        return null;
      } finally {
        setIsGeneratingSearchTerms(false);
      }
    },
    [setValue],
  );

  useEffect(() => {
    if (currentStep !== "searchterms") return;
    if (hasExplicitSearchTermsOverride) return;
    if (!baseResumeValidation.valid) return;
    if (autoSuggestionAttemptedRef.current) return;

    autoSuggestionAttemptedRef.current = true;
    void handleGenerateSearchTerms();
  }, [
    baseResumeValidation.valid,
    currentStep,
    handleGenerateSearchTerms,
    hasExplicitSearchTermsOverride,
  ]);

  const handleSaveBaseResume = useCallback(async () => {
    if (baseResumeValidation.valid) return goToNextStep();

    try {
      const validation = await validateBaseResume();
      if (!validation.valid) {
        toast.error(validation.message || "CV check failed");
        return null;
      }

      toast.success("Your CV is ready");
      return settings ?? null;
    } catch (error) {
      showErrorToast(error, "Failed to validate resume");
      return null;
    }
  }, [baseResumeValidation.valid, goToNextStep, settings, validateBaseResume]);

  const handleImportResumeFile = useCallback(
    async (file: File) => {
      try {
        setIsImportingResume(true);
        const dataUrl = await fileToDataUrl(file);
        const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());

        if (!match) {
          throw new Error("Resume file could not be encoded for upload.");
        }

        const document = await api.importDesignResumeFromFile({
          fileName: file.name,
          mediaType: file.type || match[1],
          dataBase64: match[2],
        });

        queryClient.setQueryData(queryKeys.designResume.current(), document);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.designResume.status(),
        });

        const validation = await validateBaseResume();
        if (!validation.valid) {
          throw new Error(validation.message || "Resume validation failed.");
        }

        toast.success("CV uploaded", {
          description: "Your CV is ready in the CV editor.",
        });
        markSearchTermsStale();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to import resume file",
        );
      } finally {
        setIsImportingResume(false);
      }
    },
    [queryClient, markSearchTermsStale, validateBaseResume],
  );

  const handleSaveSearchTerms = useCallback(async () => {
    const nextTerms = normalizeSearchTerms(getValues().searchTerms);

    if (nextTerms.length === 0) {
      toast.info("Add at least one job title to continue");
      return null;
    }

    try {
      setIsSaving(true);
      const nextSettings = await api.updateSettings({
        searchTerms: nextTerms,
      });
      syncSettingsCache(nextSettings);
      setValue("searchTerms", nextTerms);
      setValue("searchTermDraft", "");
      setSearchTermsSaved(true);
      setHasSavedSearchTermsInSession(true);
      setSearchTermsStale(false);
      toast.success("Search terms saved");
      return nextSettings;
    } catch (error) {
      showErrorToast(error, "Failed to save search terms");
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [getValues, setValue, syncSettingsCache]);

  const handlePrimaryAction = useCallback(async () => {
    if (!currentStep) return null;
    if (currentStep === "llm") {
      return await handleLlmStep();
    }
    if (currentStep === "baseresume") {
      return await handleSaveBaseResume();
    }
    return await handleSaveSearchTerms();
  }, [currentStep, handleLlmStep, handleSaveBaseResume, handleSaveSearchTerms]);

  const stepIndex = currentStep
    ? steps.findIndex((step) => step.id === currentStep)
    : 0;
  const canGoBack = stepIndex > 0;
  const isBusy =
    isSaving ||
    settingsLoading ||
    isImportingResume ||
    isGeneratingSearchTerms ||
    isValidatingLlm ||
    isValidatingBaseResume;

  const currentCopy = currentStep ? STEP_COPY[currentStep] : STEP_COPY.llm;

  const primaryLabel =
    currentStep === "llm"
      ? llmValidated
        ? "Continue"
        : "Check connection"
      : currentStep === "baseresume"
        ? baseResumeValidation.valid
          ? "Continue"
          : "Check CV"
        : hasSavedSearchTermsInSession
          ? "Update search terms"
          : "Save search terms";

  return {
    baseResumeValidation,
    canGoBack,
    complete,
    control,
    currentCopy,
    currentStep,
    demoMode,
    handleImportResumeFile,
    isBusy,
    isGeneratingSearchTerms,
    isImportingResume,
    hasSavedSearchTermsInSession,
    llmValidated,
    llmValidation,
    primaryLabel,
    progressValue,
    searchTermsComplete,
    searchTermsSource,
    searchTermsStale,
    settings,
    settingsLoading,
    steps,
    watch,
    setCurrentStep,
    setValue,
    handleAiAccountChange,
    handleRegenerateSearchTerms: async () => {
      await handleGenerateSearchTerms({ showToast: true });
    },
    handleBack: () => {
      if (!canGoBack) return;
      setCurrentStep(steps[stepIndex - 1]?.id ?? currentStep);
    },
    handlePrimaryAction,
  };
}
