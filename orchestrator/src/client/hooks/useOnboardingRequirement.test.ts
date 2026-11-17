import * as api from "@client/api";
import { useDemoInfo } from "@client/hooks/useDemoInfo";
import { useSettings } from "@client/hooks/useSettings";
import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithQueryClient } from "../test/renderWithQueryClient";
import { useOnboardingRequirement } from "./useOnboardingRequirement";

vi.mock("@client/api", () => ({
  validateLlm: vi.fn(),
  validateResumeConfig: vi.fn(),
}));

vi.mock("@client/hooks/useDemoInfo", () => ({
  useDemoInfo: vi.fn(),
}));

vi.mock("@client/hooks/useSettings", () => ({
  useSettings: vi.fn(),
}));

function mockSettings(getSettings: () => any) {
  vi.mocked(useSettings).mockImplementation(() => ({
    settings: getSettings(),
    isLoading: false,
    refreshSettings: vi.fn(),
    error: null,
    renderMarkdownInJobDescriptions: true,
  }));
}

describe("useOnboardingRequirement", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useDemoInfo).mockReturnValue({
      demoMode: false,
      resetCadenceHours: 6,
      lastResetAt: null,
      nextResetAt: null,
      baselineVersion: null,
      baselineName: null,
    });

    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
  });

  it("treats the persisted onboarding basic-auth decision as the source of truth", async () => {
    let currentSettings: any = {
      model: {
        value: "opus:medium",
        default: "opus:medium",
        override: null,
      },
      searchTerms: {
        value: ["Platform Engineer"],
        default: ["web developer"],
        override: null,
      },
      basicAuthActive: false,
      onboardingBasicAuthDecision: null,
    };
    mockSettings(() => currentSettings);

    const { result, rerender } = renderHookWithQueryClient(() =>
      useOnboardingRequirement(),
    );

    await waitFor(() => {
      expect(result.current.checking).toBe(false);
    });
    expect(result.current.complete).toBe(false);

    currentSettings = {
      ...currentSettings,
      searchTerms: {
        value: ["Platform Engineer"],
        default: ["web developer"],
        override: ["Platform Engineer"],
      },
      onboardingBasicAuthDecision: "skipped",
    };
    rerender();

    await waitFor(() => {
      expect(result.current.complete).toBe(true);
    });
  });

  it("validates the Claude connection before treating onboarding as complete", async () => {
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: false,
      message: "Claude is not signed in",
    });

    const currentSettings: any = {
      model: {
        value: "opus:medium",
        default: "opus:medium",
        override: null,
      },
      searchTerms: {
        value: ["Platform Engineer"],
        default: ["web developer"],
        override: ["Platform Engineer"],
      },
      basicAuthActive: false,
      onboardingBasicAuthDecision: "skipped",
    };
    mockSettings(() => currentSettings);

    const { result } = renderHookWithQueryClient(() =>
      useOnboardingRequirement(),
    );

    await waitFor(() => {
      expect(api.validateLlm).toHaveBeenCalledWith();
    });

    await waitFor(() => {
      expect(result.current.checking).toBe(false);
    });

    expect(api.validateLlm).toHaveBeenCalledTimes(1);
    expect(result.current.complete).toBe(false);
  });

  it("revalidates when the model changes after an earlier failure", async () => {
    const validateLlm = vi.mocked(api.validateLlm);
    validateLlm
      .mockResolvedValueOnce({
        valid: false,
        message: "Claude is not signed in",
      })
      .mockResolvedValue({
        valid: true,
        message: null,
      });

    let currentSettings: any = {
      model: {
        value: "opus:medium",
        default: "opus:medium",
        override: null,
      },
      searchTerms: {
        value: ["Platform Engineer"],
        default: ["web developer"],
        override: ["Platform Engineer"],
      },
      basicAuthActive: false,
      onboardingBasicAuthDecision: "skipped",
    };
    mockSettings(() => currentSettings);

    const { result, rerender } = renderHookWithQueryClient(() =>
      useOnboardingRequirement(),
    );

    await waitFor(() => {
      expect(result.current.checking).toBe(false);
    });
    expect(result.current.complete).toBe(false);
    expect(validateLlm).toHaveBeenCalledTimes(1);

    currentSettings = {
      ...currentSettings,
      model: {
        value: "sonnet",
        default: "opus:medium",
        override: "sonnet",
      },
    };
    rerender();

    await waitFor(() => {
      expect(validateLlm).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(result.current.checking).toBe(false);
    });
    expect(result.current.complete).toBe(true);
  });

  it("requires a valid CV before treating onboarding as complete", async () => {
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: false,
      message:
        "No CV yet. Upload a PDF or DOCX CV, or create one in the CV editor.",
    });

    const currentSettings: any = {
      model: {
        value: "opus:medium",
        default: "opus:medium",
        override: null,
      },
      searchTerms: {
        value: ["Platform Engineer"],
        default: ["web developer"],
        override: ["Platform Engineer"],
      },
      basicAuthActive: false,
      onboardingBasicAuthDecision: "skipped",
    };
    mockSettings(() => currentSettings);

    const { result } = renderHookWithQueryClient(() =>
      useOnboardingRequirement(),
    );

    await waitFor(() => {
      expect(result.current.checking).toBe(false);
    });

    expect(api.validateResumeConfig).toHaveBeenCalledTimes(1);
    expect(result.current.complete).toBe(false);
  });

  it("requires an explicit saved search-terms override before onboarding is complete", async () => {
    const currentSettings: any = {
      model: {
        value: "opus:medium",
        default: "opus:medium",
        override: null,
      },
      searchTerms: {
        value: ["web developer"],
        default: ["web developer"],
        override: null,
      },
      basicAuthActive: false,
      onboardingBasicAuthDecision: "skipped",
    };
    mockSettings(() => currentSettings);

    const { result } = renderHookWithQueryClient(() =>
      useOnboardingRequirement(),
    );

    await waitFor(() => {
      expect(result.current.checking).toBe(false);
    });

    expect(result.current.complete).toBe(false);
  });
});
