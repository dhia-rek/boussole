import { getDefaultPromptTemplate } from "@shared/prompt-template-definitions.js";
import { createAppSettings } from "@shared/testing/factories.js";
import type { AiAccountOverview } from "@shared/types.js";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { _resetTracerReadinessCache } from "../hooks/useTracerReadiness";
import { renderWithQueryClient } from "../test/renderWithQueryClient";
import { SettingsPage } from "./SettingsPage";

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

const render = (ui: Parameters<typeof renderWithQueryClient>[0]) =>
  renderWithQueryClient(ui);

vi.mock("../api", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getAiAccountOverview: vi.fn(),
  startAiSignIn: vi.fn(),
  submitAiSignInCode: vi.fn(),
  cancelAiSignIn: vi.fn(),
  signOutAiAccount: vi.fn(),
  clearDatabase: vi.fn(),
  deleteJobsByStatus: vi.fn(),
  getTracerReadiness: vi.fn(),
  getBackups: vi.fn().mockResolvedValue({ backups: [], nextScheduled: null }),
  createManualBackup: vi.fn(),
  deleteBackup: vi.fn(),
  getCurrentAuthUser: vi.fn().mockResolvedValue({
    id: "user-1",
    username: "test",
    displayName: null,
    isSystemAdmin: false,
    isDisabled: false,
    workspaceId: "tenant_default",
    workspaceName: "Boussole",
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z",
  }),
  listWorkspaceUsers: vi.fn().mockResolvedValue([]),
  createWorkspaceUser: vi.fn(),
  setWorkspaceUserDisabled: vi.fn(),
  resetWorkspaceUserPassword: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const baseSettings = createAppSettings({
  model: { value: "opus:medium", default: "opus:medium", override: null },
  profileProjects: [
    {
      id: "proj-1",
      name: "Project One",
      description: "Desc 1",
      date: "2024",
      isVisibleInBase: true,
    },
    {
      id: "proj-2",
      name: "Project Two",
      description: "Desc 2",
      date: "2023",
      isVisibleInBase: false,
    },
  ],
});

const signedOutAccount = {
  available: true,
  signedIn: false,
  accountLabel: null,
  planLabel: null,
  usesServerLogin: false,
  message: null,
};

const aiOverview: AiAccountOverview = {
  activeProvider: "claude",
  accounts: {
    claude: {
      ...signedOutAccount,
      provider: "claude",
      signedIn: true,
      accountLabel: "nora@example.com",
      planLabel: "Claude Max",
    },
    chatgpt: { ...signedOutAccount, provider: "chatgpt" },
  },
  models: {
    claude: [
      {
        id: "opus",
        label: "Claude Opus",
        description: null,
        efforts: [{ id: "medium", description: null }],
        defaultEffort: "medium",
      },
      {
        id: "sonnet",
        label: "Claude Sonnet",
        description: null,
        efforts: [{ id: "medium", description: null }],
        defaultEffort: "medium",
      },
    ],
    chatgpt: [],
  },
  selectedModels: { claude: "opus:medium", chatgpt: "" },
  signIn: null,
};

const renderPage = () => {
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <SettingsPage />
    </MemoryRouter>,
  );
};

const getSaveButton = () =>
  screen.getByRole("button", { name: /save changes/i });

const openNavGroup = async (name: RegExp) => {
  const groupButton = await screen.findByRole("button", { name });
  fireEvent.click(groupButton);
};

const clickLastButtonByName = async (name: RegExp) => {
  const buttons = await screen.findAllByRole("button", { name });
  const target = buttons.at(-1);
  expect(target).toBeDefined();
  fireEvent.click(target as HTMLElement);
};

const openAiAccountSection = async () => {
  await openNavGroup(/^ai$/i);
  await clickLastButtonByName(/^ai account$/i);
};

const openWritingStyleSection = async () => {
  await openNavGroup(/^ai$/i);
  await clickLastButtonByName(/writing style/i);
};

const openPromptTemplatesSection = async () => {
  await openNavGroup(/^ai$/i);
  await clickLastButtonByName(/prompt templates/i);
};

const openDisplaySection = async () => {
  await openNavGroup(/^display$/i);
  await clickLastButtonByName(/display preferences/i);
};

const openEnvironmentSection = async () => {
  await openNavGroup(/^workspaces & security$/i);
  await clickLastButtonByName(/workspace access/i);
};

const openScoringSection = async () => {
  await openNavGroup(/^scoring$/i);
  await clickLastButtonByName(/rules.*filters/i);
};

const openDangerZoneSection = async () => {
  await openNavGroup(/^danger zone$/i);
  await clickLastButtonByName(/danger zone/i);
};

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    _resetTracerReadinessCache();
    vi.mocked(api.getAiAccountOverview).mockResolvedValue(aiOverview);
    vi.mocked(api.getTracerReadiness).mockResolvedValue({
      status: "ready",
      isPubliclyAvailable: true,
      canEnable: true,
      publicBaseUrl: "https://my-boussole.example.com",
      healthUrl: "https://my-boussole.example.com/health",
      checkedAt: Date.now(),
      lastSuccessAt: Date.now(),
      reason: null,
    });
  });

  afterAll(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: originalScrollIntoView,
    });
  });

  it("opens on the AI account section with the account in use", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);

    renderPage();

    const heading = await screen.findByRole("heading", { name: "AI account" });
    const claude = await screen.findByRole("region", {
      name: "Claude account",
    });
    expect(
      within(claude).getByText("Signed in as nora@example.com"),
    ).toBeInTheDocument();
    expect(heading.parentElement).toHaveTextContent("Using Claude");
    expect(
      screen.getByRole("region", { name: "ChatGPT account" }),
    ).toBeInTheDocument();
    expect(getSaveButton()).toBeDisabled();
  });

  it("flags the AI account section when the chosen account is signed out", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
    vi.mocked(api.getAiAccountOverview).mockResolvedValue({
      ...aiOverview,
      accounts: {
        claude: { ...signedOutAccount, provider: "claude" },
        chatgpt: { ...signedOutAccount, provider: "chatgpt" },
      },
    });

    renderPage();

    const heading = await screen.findByRole("heading", { name: "AI account" });
    await waitFor(() =>
      expect(heading.parentElement).toHaveTextContent("Not signed in"),
    );
    expect(
      within(
        await screen.findByRole("region", { name: "Claude account" }),
      ).getByText("Not signed in"),
    ).toBeInTheDocument();
  });

  it("clears jobs by status and summarizes results", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
    vi.mocked(api.deleteJobsByStatus).mockResolvedValue({
      message: "",
      count: 2,
    });

    renderPage();

    await openDangerZoneSection();

    const clearSelectedButton = await screen.findByRole("button", {
      name: /clear selected/i,
    });
    fireEvent.click(clearSelectedButton);

    const confirmButton = await screen.findByRole("button", {
      name: /clear 1 status/i,
    });
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(api.deleteJobsByStatus).toHaveBeenCalledWith("discovered"),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Jobs cleared",
      expect.objectContaining({
        description: "Deleted 2 jobs: 2 discovered",
      }),
    );
  });

  it("saves the model straight away, outside the settings form", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
    vi.mocked(api.updateSettings).mockResolvedValue(baseSettings);

    renderPage();
    await openAiAccountSection();

    const claude = await screen.findByRole("region", {
      name: "Claude account",
    });
    fireEvent.click(
      within(claude).getByRole("combobox", { name: "Claude model" }),
    );
    fireEvent.click(
      await screen.findByRole("option", { name: "Claude Sonnet" }),
    );

    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({
        model: "sonnet:medium",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Model saved");
    expect(getSaveButton()).toBeDisabled();
  });

  it("does not send the AI model when saving an unrelated setting", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      createAppSettings({
        model: {
          value: "sonnet",
          default: "opus:medium",
          override: "sonnet",
        },
      }),
    );
    vi.mocked(api.updateSettings).mockResolvedValue(
      createAppSettings({
        model: {
          value: "sonnet",
          default: "opus:medium",
          override: "sonnet",
        },
        renderMarkdownInJobDescriptions: {
          value: false,
          default: true,
          override: false,
        },
      }),
    );

    renderPage();

    await openDisplaySection();
    fireEvent.click(
      screen.getByLabelText(/render markdown in job descriptions/i),
    );

    const saveButton = getSaveButton();
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        renderMarkdownInJobDescriptions: false,
      }),
    );
    // The AI account section saves the model itself.
    const payload = vi.mocked(api.updateSettings).mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty("model");
    expect(payload).not.toHaveProperty("chatgptModel");
    expect(payload).not.toHaveProperty("aiProvider");
  });

  it("hides pipeline tuning sections that moved to run modal", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
    renderPage();

    await openAiAccountSection();
    expect(
      screen.queryByRole("button", { name: /search terms/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /jobspy scraper/i }),
    ).not.toBeInTheDocument();
  });

  it("enables save button when display setting is changed", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
    renderPage();
    const saveButton = getSaveButton();

    await openDisplaySection();
    const markdownCheckbox = screen.getByLabelText(
      /render markdown in job descriptions/i,
    );
    fireEvent.click(markdownCheckbox);
    await waitFor(() => expect(saveButton).toBeEnabled());
  });

  it("saves the writing language mode through the settings page", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
    vi.mocked(api.updateSettings).mockResolvedValue(
      createAppSettings({
        chatStyleLanguageMode: {
          value: "match-resume",
          default: "manual",
          override: "match-resume",
        },
      }),
    );

    renderPage();
    await openWritingStyleSection();

    fireEvent.click(screen.getByRole("combobox", { name: /output language/i }));
    fireEvent.click(await screen.findByText("Match current resume language"));

    expect(
      screen.queryByRole("combobox", { name: /specific language/i }),
    ).not.toBeInTheDocument();

    const saveButton = getSaveButton();
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        chatStyleLanguageMode: "match-resume",
        chatStyleManualLanguage: null,
      }),
    );
  });

  it("saves the Ghostwriter Stop Slop toggle through the settings page", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
    vi.mocked(api.updateSettings).mockResolvedValue(
      createAppSettings({
        ghostwriterStopSlopEnabled: {
          value: true,
          default: false,
          override: true,
        },
      }),
    );

    renderPage();
    await openWritingStyleSection();

    const stopSlopCheckbox = screen.getByLabelText(
      /use stop slop for ghostwriter/i,
    );
    expect(stopSlopCheckbox).not.toBeChecked();

    fireEvent.click(stopSlopCheckbox);

    const saveButton = getSaveButton();
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        ghostwriterStopSlopEnabled: true,
      }),
    );
  });

  it("enables save button when the authentication toggle is changed", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
    renderPage();
    const saveButton = getSaveButton();

    await openEnvironmentSection();
    const authCheckbox = screen.getByLabelText(/enable authentication/i);
    fireEvent.click(authCheckbox);
    expect(saveButton).toBeEnabled();
  });

  it("wipes auth credentials when the toggle is disabled and saved", async () => {
    // Initial state: authentication is active
    const activeSettings = {
      ...baseSettings,
      basicAuthActive: true,
      basicAuthUser: "admin",
      basicAuthPasswordHint: "pass",
    };
    vi.mocked(api.getSettings).mockResolvedValue(activeSettings);
    vi.mocked(api.updateSettings).mockResolvedValue(baseSettings);

    renderPage();

    await openEnvironmentSection();

    const authCheckbox = screen.getByLabelText(/enable authentication/i);
    expect(authCheckbox).toBeChecked();

    // Disable it
    fireEvent.click(authCheckbox);
    expect(authCheckbox).not.toBeChecked();

    const saveButton = getSaveButton();
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        basicAuthUser: null,
        basicAuthPassword: null,
      }),
    );
  });

  it("saves blocked company keywords from scoring settings", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
    vi.mocked(api.updateSettings).mockResolvedValue({
      ...baseSettings,
      blockedCompanyKeywords: {
        value: ["staffing"],
        default: [],
        override: ["staffing"],
      },
    });

    renderPage();

    await openScoringSection();

    const input = screen.getByPlaceholderText('e.g. "recruitment", "staffing"');
    fireEvent.change(input, { target: { value: "staffing" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const saveButton = getSaveButton();
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        blockedCompanyKeywords: ["staffing"],
      }),
    );
  });

  it("saves auto-skip score threshold from scoring settings", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
    vi.mocked(api.updateSettings).mockResolvedValue({
      ...baseSettings,
      autoSkipScoreThreshold: {
        value: 42,
        default: null,
        override: 42,
      },
    });

    renderPage();

    await openScoringSection();

    const input = screen.getByLabelText(/auto-skip score threshold/i);
    fireEvent.change(input, { target: { value: "42" } });

    const saveButton = getSaveButton();
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        autoSkipScoreThreshold: 42,
      }),
    );
  });

  it("sends null for both numeric limit fields on reset-to-default", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      createAppSettings({
        chatStyleSummaryMaxWords: {
          value: 35,
          default: null,
          override: 35,
        },
        chatStyleMaxKeywordsPerSkill: {
          value: 8,
          default: null,
          override: 8,
        },
      }),
    );
    vi.mocked(api.updateSettings).mockResolvedValue(baseSettings);

    renderPage();

    const resetButton = await screen.findByRole("button", {
      name: /reset to default/i,
    });
    fireEvent.click(resetButton);

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        chatStyleSummaryMaxWords: null,
        chatStyleMaxKeywordsPerSkill: null,
        model: null,
        chatgptModel: null,
      }),
    );
    // The account choice is kept; the panel re-reads the reset models.
    expect(api.updateSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ aiProvider: expect.anything() }),
    );
    await waitFor(() =>
      expect(api.getAiAccountOverview).toHaveBeenCalledTimes(2),
    );
  });

  it("saves scoring instructions from scoring settings", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
    vi.mocked(api.updateSettings).mockResolvedValue({
      ...baseSettings,
      scoringInstructions: {
        value:
          "Open to relocating, so do not mark down for location discrepancies.",
        default: "",
        override:
          "Open to relocating, so do not mark down for location discrepancies.",
      },
    });

    renderPage();

    await openScoringSection();

    const textarea = screen.getByLabelText(/scoring instructions/i);
    fireEvent.change(textarea, {
      target: {
        value:
          "Open to relocating, so do not mark down for location discrepancies.",
      },
    });

    const saveButton = getSaveButton();
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        scoringInstructions:
          "Open to relocating, so do not mark down for location discrepancies.",
      }),
    );
  });

  it("serializes prompt templates back to null when reset to defaults", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      createAppSettings({
        ghostwriterSystemPromptTemplate: {
          value: "Custom Ghostwriter",
          default: getDefaultPromptTemplate("ghostwriterSystemPromptTemplate"),
          override: "Custom Ghostwriter",
        },
      }),
    );
    vi.mocked(api.updateSettings).mockResolvedValue(baseSettings);

    renderPage();

    await openPromptTemplatesSection();

    fireEvent.click(screen.getAllByRole("button", { name: /^reset$/i })[0]);

    const saveButton = getSaveButton();
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        ghostwriterSystemPromptTemplate: null,
      }),
    );
  });
});
