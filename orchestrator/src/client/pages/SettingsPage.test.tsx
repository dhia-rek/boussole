import { getDefaultPromptTemplate } from "@shared/prompt-template-definitions.js";
import { createAppSettings } from "@shared/testing/factories.js";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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

const openModelSection = async () => {
  await openNavGroup(/^ai$/i);
  await clickLastButtonByName(/ai model/i);
};

const getModelInput = () => screen.getByLabelText(/claude model/i);

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

  it("saves trimmed model overrides", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
    vi.mocked(api.updateSettings).mockResolvedValue({
      ...baseSettings,
      model: {
        value: "sonnet",
        default: baseSettings.model.default,
        override: "sonnet",
      },
    });

    renderPage();
    await openModelSection();

    const modelInput = getModelInput();
    await waitFor(() => expect(modelInput).toBeEnabled());
    fireEvent.change(modelInput, { target: { value: "  sonnet  " } });

    const saveButton = getSaveButton();
    await waitFor(() => expect(saveButton).toBeEnabled());

    fireEvent.click(saveButton);

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "sonnet",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Settings saved");
  });

  it("shows validation error for too long model override", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);

    renderPage();
    await openModelSection();

    const modelInput = getModelInput();
    await waitFor(() => expect(modelInput).toBeEnabled());

    // Change to > 200 chars
    fireEvent.change(modelInput, { target: { value: "a".repeat(201) } });

    // Should see error message
    expect(
      await screen.findByText(
        /String must contain at most 200 character\(s\)/i,
      ),
    ).toBeInTheDocument();

    // Save button should be disabled due to validation error (isValid will be false)
    const saveButton = getSaveButton();
    expect(saveButton).toBeDisabled();
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

  it("enables save button when model is changed", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
    renderPage();
    const saveButton = getSaveButton();
    expect(saveButton).toBeDisabled();
    await openModelSection();

    const modelInput = getModelInput();
    // Wait for the query to resolve and input to be enabled
    await waitFor(() => expect(modelInput).toBeEnabled());

    fireEvent.change(modelInput, { target: { value: "haiku" } });
    await waitFor(() => expect(saveButton).toBeEnabled());
  });

  it("does not mark the AI model section dirty on initial load", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      createAppSettings({
        model: {
          value: "sonnet",
          default: "opus:medium",
          override: "sonnet",
        },
      }),
    );

    renderPage();
    await openModelSection();

    expect(
      screen.getByRole("heading", { name: "AI model" }),
    ).toBeInTheDocument();
    const modelInput = getModelInput();
    await waitFor(() => expect(modelInput).toHaveValue("sonnet"));
    expect(modelInput).toHaveAttribute("placeholder", "opus:medium");
    expect(screen.getByText("In use: sonnet")).toBeInTheDocument();

    const saveButton = getSaveButton();
    await waitFor(() => expect(saveButton).toBeDisabled());
  });

  it("does not clear the model override when saving an unrelated setting", async () => {
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
        model: "sonnet",
        renderMarkdownInJobDescriptions: false,
      }),
    );
  });

  it("hides pipeline tuning sections that moved to run modal", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
    renderPage();

    await openModelSection();
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
      }),
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
