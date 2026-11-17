import * as api from "@client/api";
import { useDemoInfo } from "@client/hooks/useDemoInfo";
import { useOnboardingRequirement } from "@client/hooks/useOnboardingRequirement";
import { useSettings } from "@client/hooks/useSettings";
import { createDesignResumeDocument } from "@shared/testing/factories";
import type { AiAccountOverview, AiAccountStatus } from "@shared/types";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { toast } from "sonner";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQueryClient } from "../test/renderWithQueryClient";
import { OnboardingPage } from "./OnboardingPage";

vi.mock("@client/api", () => ({
  importDesignResumeFromFile: vi.fn(),
  suggestOnboardingSearchTerms: vi.fn(),
  validateLlm: vi.fn(),
  validateResumeConfig: vi.fn(),
  updateSettings: vi.fn(),
  getAiAccountOverview: vi.fn(),
  startAiSignIn: vi.fn(),
  submitAiSignInCode: vi.fn(),
  cancelAiSignIn: vi.fn(),
  signOutAiAccount: vi.fn(),
}));

vi.mock("@client/hooks/useDemoInfo", () => ({
  useDemoInfo: vi.fn(),
}));

vi.mock("@client/hooks/useSettings", () => ({
  useSettings: vi.fn(),
}));

vi.mock("@client/hooks/useOnboardingRequirement", () => ({
  useOnboardingRequirement: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

const NO_CV_MESSAGE =
  "No CV yet. Upload a PDF or DOCX CV, or create one in the CV editor.";
const NOT_SIGNED_IN_MESSAGE =
  "Sign in with your Claude account to use the AI features.";

function aiAccount(
  provider: AiAccountStatus["provider"],
  overrides: Partial<AiAccountStatus> = {},
): AiAccountStatus {
  return {
    provider,
    available: true,
    signedIn: false,
    accountLabel: null,
    planLabel: null,
    usesServerLogin: false,
    message: null,
    ...overrides,
  };
}

function aiOverview(
  overrides: Partial<AiAccountOverview> = {},
): AiAccountOverview {
  const efforts = [{ id: "medium", description: null }];
  return {
    activeProvider: "claude",
    accounts: {
      claude: aiAccount("claude", { signedIn: true }),
      chatgpt: aiAccount("chatgpt"),
    },
    models: {
      claude: [
        {
          id: "opus",
          label: "Claude Opus",
          description: null,
          efforts,
          defaultEffort: "medium",
        },
        {
          id: "sonnet",
          label: "Claude Sonnet",
          description: null,
          efforts,
          defaultEffort: "medium",
        },
      ],
      chatgpt: [],
    },
    selectedModels: { claude: "opus:medium", chatgpt: "" },
    signIn: null,
    ...overrides,
  };
}

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

const baseSettings = {
  model: { value: "opus:medium", default: "opus:medium", override: null },
  onboardingBasicAuthDecision: null,
  searchTerms: {
    value: ["Platform Engineer"],
    default: ["web developer"],
    override: ["Platform Engineer"],
  },
  basicAuthUser: null,
  basicAuthPassword: null,
  basicAuthPasswordHint: null,
  basicAuthActive: false,
};

let currentSettings: any;

function getStepButton(label: RegExp) {
  const element = screen.getByText(label);
  const button = element.closest("button");
  if (!button) {
    throw new Error(`Expected ${label.toString()} to be inside a step button`);
  }
  return button;
}

/** The first step shows the AI account panel. */
async function waitForAiStep() {
  return await screen.findByRole("region", { name: "Claude account" });
}

function getResumeUploadInput(container: HTMLElement) {
  const input = container.querySelector(
    'input[type="file"][accept*=".pdf"]',
  ) as HTMLInputElement | null;
  if (!input) {
    throw new Error("Expected resume upload input");
  }
  return input;
}

function renderPage() {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={["/onboarding"]}>
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/jobs/ready" element={<div>ready page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("OnboardingPage", () => {
  afterAll(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: originalScrollIntoView,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    currentSettings = { ...baseSettings };
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    vi.mocked(api.getAiAccountOverview).mockResolvedValue(aiOverview());

    vi.mocked(useDemoInfo).mockReturnValue({
      demoMode: false,
      resetCadenceHours: 6,
      lastResetAt: null,
      nextResetAt: null,
      baselineVersion: null,
      baselineName: null,
    });

    vi.mocked(useSettings).mockImplementation(() => ({
      settings: currentSettings,
      isLoading: false,
      refreshSettings: vi.fn(),
      error: null,
      renderMarkdownInJobDescriptions: true,
    }));

    vi.mocked(useOnboardingRequirement).mockImplementation(() => ({
      checking: false,
      complete: Boolean(
        (currentSettings.basicAuthActive ||
          currentSettings.onboardingBasicAuthDecision !== null) &&
          Array.isArray(currentSettings.searchTerms?.override) &&
          currentSettings.searchTerms.override.length > 0,
      ),
    }));
    vi.mocked(api.suggestOnboardingSearchTerms).mockResolvedValue({
      terms: ["Platform Engineer", "Backend Engineer"],
      source: "ai",
    });
  });

  it("shows the AI account panel on the first step", async () => {
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: false,
      message: NOT_SIGNED_IN_MESSAGE,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });

    renderPage();

    await waitFor(() => expect(api.validateLlm).toHaveBeenCalledWith());

    await waitForAiStep();
    expect(screen.getByText("Connect your AI")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "ChatGPT account" }),
    ).toBeInTheDocument();
    expect(getStepButton(/^AI account$/)).toHaveTextContent(
      "Sign in with Claude or ChatGPT",
    );
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /check connection/i }),
    ).toBeInTheDocument();
  });

  it("saves the chosen model from the first step", async () => {
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.updateSettings).mockResolvedValue(baseSettings as any);

    renderPage();

    const claude = await waitForAiStep();
    fireEvent.click(
      within(claude).getByRole("combobox", { name: "Claude model" }),
    );
    fireEvent.click(
      await screen.findByRole("option", { name: "Claude Sonnet" }),
    );

    await waitFor(() => {
      expect(api.updateSettings).toHaveBeenCalledWith({
        model: "sonnet:medium",
      });
    });
    // Picking a model does not submit the step.
    expect(api.validateLlm).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Connect your AI")).toBeInTheDocument();
  });

  it("does not treat the AI account as connected before the check passes", async () => {
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: false,
      message: NOT_SIGNED_IN_MESSAGE,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /check connection/i }),
      ).toBeEnabled();
    });
    expect(
      screen.queryByRole("button", { name: /^continue/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(NOT_SIGNED_IN_MESSAGE)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /check connection/i }));

    await waitFor(() => {
      expect(screen.getByText(NOT_SIGNED_IN_MESSAGE)).toBeInTheDocument();
    });
    expect(api.validateLlm).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith(NOT_SIGNED_IN_MESSAGE);
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it("shows the AI account success state in the detail panel", async () => {
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText("Your AI account is connected."),
      ).toBeInTheDocument();
    });
  });

  it("re-checks the first step when the panel switches to a signed-in account", async () => {
    vi.mocked(api.getAiAccountOverview).mockResolvedValue(
      aiOverview({
        accounts: {
          claude: aiAccount("claude"),
          chatgpt: aiAccount("chatgpt", {
            signedIn: true,
            planLabel: "ChatGPT plan",
          }),
        },
      }),
    );
    vi.mocked(api.validateLlm)
      .mockResolvedValueOnce({ valid: false, message: NOT_SIGNED_IN_MESSAGE })
      .mockResolvedValue({ valid: true, message: null });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.updateSettings).mockResolvedValue(baseSettings as any);

    renderPage();

    const chatgpt = await screen.findByRole("region", {
      name: "ChatGPT account",
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /check connection/i }),
      ).toBeEnabled();
    });

    fireEvent.click(
      within(chatgpt).getByRole("button", { name: "Use ChatGPT" }),
    );

    await waitFor(() => {
      expect(api.updateSettings).toHaveBeenCalledWith({
        aiProvider: "chatgpt",
      });
    });
    await waitFor(() => expect(api.validateLlm).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("button", { name: /^continue/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Your AI account is connected."),
    ).toBeInTheDocument();
  });

  it("defaults the authentication step to lock it down", async () => {
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });

    renderPage();

    await waitForAiStep();

    fireEvent.click(screen.getByRole("button", { name: /basic auth/i }));

    await waitFor(() => {
      expect(screen.getByText("Secure your workspace")).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/lock it down/i)).toBeChecked();
    expect(
      screen.getByRole("button", { name: /enable authentication/i }),
    ).toBeInTheDocument();
  });

  it("renders the new search terms step in the onboarding rail", async () => {
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /search terms/i }),
      ).toBeInTheDocument();
    });
  });

  it("does not auto-generate search terms when explicit saved terms already exist", async () => {
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /search terms/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Choose the job titles to search for."),
      ).toBeInTheDocument();
    });

    expect(api.suggestOnboardingSearchTerms).not.toHaveBeenCalled();
    expect(screen.getByText(/saved search terms/i)).toBeInTheDocument();
  });

  it("auto-populates search terms from the resume when no explicit override exists", async () => {
    currentSettings = {
      ...baseSettings,
      searchTerms: {
        value: ["web developer"],
        default: ["web developer"],
        override: null,
      },
    };

    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.suggestOnboardingSearchTerms).mockResolvedValue({
      terms: ["Platform Engineer", "Backend Engineer"],
      source: "ai",
    });

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /search terms/i }));

    await waitFor(() => {
      expect(api.suggestOnboardingSearchTerms).toHaveBeenCalledTimes(1);
    });

    expect(
      screen.getByText(/^generated from your resume$/i),
    ).toBeInTheDocument();

    const collapsedTokens = screen.getByTestId(
      "onboarding-search-terms-collapsed-tokens",
    );
    expect(
      within(collapsedTokens).getByText("Platform Engineer"),
    ).toBeInTheDocument();
    expect(
      within(collapsedTokens).getByText("Backend Engineer"),
    ).toBeInTheDocument();
  });

  it("saves edited search terms through settings updates", async () => {
    currentSettings = {
      ...baseSettings,
      searchTerms: {
        value: ["web developer"],
        default: ["web developer"],
        override: null,
      },
    };

    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.suggestOnboardingSearchTerms).mockResolvedValue({
      terms: ["Platform Engineer", "Backend Engineer"],
      source: "ai",
    });
    vi.mocked(api.updateSettings).mockImplementation(async (update) => {
      currentSettings = {
        ...currentSettings,
        ...("searchTerms" in update
          ? {
              searchTerms: {
                value: update.searchTerms,
                default: ["web developer"],
                override: update.searchTerms,
              },
            }
          : {}),
      };
      return currentSettings;
    });

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /search terms/i }));

    await waitFor(() => {
      expect(api.suggestOnboardingSearchTerms).toHaveBeenCalledTimes(1);
    });

    const input = screen.getByPlaceholderText("Type a role and press Enter");
    fireEvent.change(input, {
      target: { value: "Staff Software Engineer" },
    });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /save search terms/i }));

    await waitFor(() => {
      expect(api.updateSettings).toHaveBeenCalledWith({
        searchTerms: [
          "Platform Engineer",
          "Backend Engineer",
          "Staff Software Engineer",
        ],
      });
    });
  });

  it("lets the user skip basic auth and finish onboarding", async () => {
    vi.mocked(useOnboardingRequirement).mockReturnValue({
      checking: false,
      complete: false,
    });
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.updateSettings).mockImplementation(async () => {
      currentSettings = {
        ...currentSettings,
        onboardingBasicAuthDecision: "skipped",
      };
      return {
        ...currentSettings,
        searchTerms: {
          ...currentSettings.searchTerms,
          override: null,
        },
      };
    });

    renderPage();

    await waitForAiStep();

    fireEvent.click(screen.getByRole("button", { name: /basic auth/i }));

    await waitFor(() => {
      expect(screen.getByText("Secure your workspace")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/skip for now/i));
    fireEvent.click(screen.getByRole("button", { name: /finish onboarding/i }));

    await waitFor(() => {
      expect(screen.getByText("ready page")).toBeInTheDocument();
    });
    expect(api.updateSettings).toHaveBeenCalledWith({
      onboardingBasicAuthDecision: "skipped",
    });
  });

  it("lets the user enable basic auth and finish onboarding", async () => {
    vi.mocked(useOnboardingRequirement).mockReturnValue({
      checking: false,
      complete: false,
    });
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.updateSettings).mockImplementation(async (update) => {
      currentSettings = {
        ...currentSettings,
        ...("enableBasicAuth" in update || "basicAuthUser" in update
          ? {
              basicAuthActive: true,
              onboardingBasicAuthDecision: "enabled",
              basicAuthUser:
                update.basicAuthUser ?? currentSettings.basicAuthUser,
            }
          : {}),
      };
      return currentSettings;
    });

    renderPage();

    await waitForAiStep();

    fireEvent.click(screen.getByRole("button", { name: /basic auth/i }));

    await waitFor(() => {
      expect(screen.getByText("Secure your workspace")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/lock it down/i));
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "forsa-admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /enable authentication/i }),
    );

    await waitFor(() => {
      expect(screen.getByText("ready page")).toBeInTheDocument();
    });
    expect(api.updateSettings).toHaveBeenCalledWith({
      enableBasicAuth: true,
      basicAuthUser: "forsa-admin",
      basicAuthPassword: "correct horse battery staple",
      onboardingBasicAuthDecision: "enabled",
    });
  });

  it("redirects when search terms are the last missing step", async () => {
    vi.mocked(useOnboardingRequirement).mockReturnValue({
      checking: false,
      complete: false,
    });
    currentSettings = {
      ...baseSettings,
      onboardingBasicAuthDecision: "skipped",
      searchTerms: {
        value: ["web developer"],
        default: ["web developer"],
        override: null,
      },
    };
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.updateSettings).mockImplementation(async (update) => {
      currentSettings = {
        ...currentSettings,
        ...("searchTerms" in update
          ? {
              searchTerms: {
                value: update.searchTerms,
                default: ["web developer"],
                override: update.searchTerms,
              },
            }
          : {}),
      };
      return currentSettings;
    });

    renderPage();

    await waitForAiStep();

    fireEvent.click(screen.getByRole("button", { name: /search terms/i }));

    await waitFor(() => {
      expect(api.suggestOnboardingSearchTerms).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /save search terms/i }));

    await waitFor(() => {
      expect(screen.getByText("ready page")).toBeInTheDocument();
    });
    expect(api.updateSettings).toHaveBeenCalledWith({
      searchTerms: ["Platform Engineer", "Backend Engineer"],
    });
  });

  it("does not leave onboarding early when basic auth is saved before the other steps are complete", async () => {
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: false,
      message: "Connection failed",
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.updateSettings).mockResolvedValue({
      ...baseSettings,
      onboardingBasicAuthDecision: "skipped",
    } as any);

    renderPage();

    await waitForAiStep();

    fireEvent.click(screen.getByRole("button", { name: /basic auth/i }));

    await waitFor(() => {
      expect(screen.getByText("Secure your workspace")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/skip for now/i));
    fireEvent.click(screen.getByRole("button", { name: /finish onboarding/i }));

    await waitFor(() => {
      expect(api.updateSettings).toHaveBeenCalledWith({
        onboardingBasicAuthDecision: "skipped",
      });
    });

    expect(screen.queryByText("ready page")).not.toBeInTheDocument();
    expect(screen.getByText("Secure your workspace")).toBeInTheDocument();
  });

  it("does not finish onboarding when only default search terms exist", async () => {
    currentSettings = {
      ...baseSettings,
      onboardingBasicAuthDecision: "skipped",
      searchTerms: {
        value: ["web developer"],
        default: ["web developer"],
        override: null,
      },
    };

    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });

    renderPage();

    await waitForAiStep();

    expect(screen.queryByText("ready page")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Claude account" }),
    ).toBeInTheDocument();
  });

  it("continues to the CV step once the AI account is connected", async () => {
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: false,
      message: NO_CV_MESSAGE,
    });

    renderPage();

    await waitForAiStep();
    expect(
      screen.queryByRole("button", { name: /revalidate connection/i }),
    ).not.toBeInTheDocument();
    const continueButton = await screen.findByRole("button", {
      name: /^continue/i,
    });
    await waitFor(() => expect(continueButton).toBeEnabled());

    fireEvent.click(continueButton);

    expect(
      await screen.findByRole("button", { name: /upload cv file/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Import your current CV.")).toBeInTheDocument();
    expect(api.validateLlm).toHaveBeenCalledTimes(1);
    expect(api.updateSettings).not.toHaveBeenCalled();
    expect(screen.queryByText("ready page")).not.toBeInTheDocument();
  });

  it("continues from the CV step when the CV is already loaded", async () => {
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });

    renderPage();

    fireEvent.click(getStepButton(/^CV$/i));

    const continueButton = await screen.findByRole("button", {
      name: /^continue/i,
    });
    await waitFor(() => expect(continueButton).toBeEnabled());
    expect(
      screen.queryByRole("button", { name: /recheck cv/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(continueButton);

    expect(
      await screen.findByText("Choose the job titles to search for."),
    ).toBeInTheDocument();
    expect(api.validateResumeConfig).toHaveBeenCalledTimes(1);
  });

  it("does not show CV errors before the user checks the step", async () => {
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: false,
      message: NO_CV_MESSAGE,
    });

    renderPage();

    fireEvent.click(getStepButton(/^CV$/i));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^check cv/i })).toBeEnabled();
    });
    expect(api.validateResumeConfig).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(NO_CV_MESSAGE)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^check cv/i }));

    await waitFor(() => {
      expect(screen.getByText(NO_CV_MESSAGE)).toBeInTheDocument();
    });
    expect(api.validateResumeConfig).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith(NO_CV_MESSAGE);
  });

  it("shows the loaded CV success state in the detail panel", async () => {
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });

    renderPage();

    fireEvent.click(getStepButton(/^CV$/i));

    await waitFor(() => {
      expect(
        screen.getByText("Your CV is loaded and ready."),
      ).toBeInTheDocument();
    });
  });

  it("uploads a PDF CV and validates it from the upload-only CV step", async () => {
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig)
      .mockResolvedValueOnce({
        valid: false,
        message: NO_CV_MESSAGE,
      })
      .mockResolvedValueOnce({
        valid: true,
        message: null,
      });
    vi.mocked(api.importDesignResumeFromFile).mockResolvedValue(
      createDesignResumeDocument(),
    );

    const { container } = renderPage();

    fireEvent.click(getStepButton(/^CV$/i));

    expect(
      await screen.findByRole("button", { name: /upload cv file/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Use Reactive Resume")).not.toBeInTheDocument();

    const input = getResumeUploadInput(container);
    expect(input.accept).toContain(".docx");

    fireEvent.change(input, {
      target: {
        files: [
          new File(["resume"], "resume.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });

    await waitFor(() => {
      expect(api.importDesignResumeFromFile).toHaveBeenCalledWith({
        fileName: "resume.pdf",
        mediaType: "application/pdf",
        dataBase64: expect.any(String),
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText("Your CV is loaded and ready."),
      ).toBeInTheDocument();
    });
    expect(api.validateResumeConfig).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith("CV uploaded", {
      description: "Your CV is ready in the CV editor.",
    });
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it("marks the search terms step stale after the resume changes", async () => {
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig)
      .mockResolvedValueOnce({
        valid: true,
        message: null,
      })
      .mockResolvedValueOnce({
        valid: true,
        message: null,
      });
    vi.mocked(api.importDesignResumeFromFile).mockResolvedValue(
      createDesignResumeDocument(),
    );

    const { container } = renderPage();

    fireEvent.click(getStepButton(/^CV$/i));

    const input = getResumeUploadInput(container);

    fireEvent.change(input, {
      target: {
        files: [
          new File(["resume"], "resume.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });

    await waitFor(() => {
      expect(api.importDesignResumeFromFile).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: /search terms/i }));

    await waitFor(() => {
      expect(screen.getByText(/resume changed/i)).toBeInTheDocument();
    });
  });

  it("lets the full authentication option card change the selection", async () => {
    vi.mocked(api.validateLlm).mockResolvedValue({
      valid: true,
      message: null,
    });
    vi.mocked(api.validateResumeConfig).mockResolvedValue({
      valid: true,
      message: null,
    });

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /basic auth/i }));

    await waitFor(() => {
      expect(screen.getByText("Secure your workspace")).toBeInTheDocument();
    });

    const skipCard = screen
      .getByText(/you can add authentication later from settings\./i)
      .closest("label");

    if (!skipCard) {
      throw new Error("Expected the skip card to render as a label");
    }

    fireEvent.click(skipCard);

    expect(
      screen.getByRole("button", { name: /finish onboarding/i }),
    ).toBeEnabled();
  });
});
