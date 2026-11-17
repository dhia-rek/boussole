import * as api from "@client/api";
import { queryKeys } from "@client/lib/queryKeys";
import { renderWithQueryClient } from "@client/test/renderWithQueryClient";
import type {
  AiAccountOverview,
  AiAccountStatus,
  AiModelOption,
  AiProvider,
  AiSignInSession,
} from "@shared/types";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiAccountPanel } from "./AiAccountPanel";

vi.mock("@client/api", () => ({
  getAiAccountOverview: vi.fn(),
  startAiSignIn: vi.fn(),
  submitAiSignInCode: vi.fn(),
  cancelAiSignIn: vi.fn(),
  signOutAiAccount: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const EFFORTS = [
  { id: "low", description: "Fastest answers" },
  { id: "medium", description: "Balanced (recommended)" },
  { id: "high", description: "Deeper reasoning" },
];

const CLAUDE_MODELS: AiModelOption[] = [
  {
    id: "opus",
    label: "Claude Opus",
    description: "Most capable.",
    efforts: EFFORTS,
    defaultEffort: "medium",
  },
  {
    id: "sonnet",
    label: "Claude Sonnet",
    description: "Fast and capable.",
    efforts: EFFORTS,
    defaultEffort: "medium",
  },
];

const CHATGPT_MODELS: AiModelOption[] = [
  {
    id: "gpt-codex",
    label: "GPT Codex",
    description: "Tuned for agent work.",
    efforts: EFFORTS,
    defaultEffort: "medium",
  },
];

function account(
  provider: AiProvider,
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

function overview(
  overrides: Partial<AiAccountOverview> = {},
): AiAccountOverview {
  return {
    activeProvider: "claude",
    accounts: { claude: account("claude"), chatgpt: account("chatgpt") },
    models: { claude: CLAUDE_MODELS, chatgpt: [] },
    selectedModels: { claude: "opus:medium", chatgpt: "" },
    signIn: null,
    ...overrides,
  };
}

function session(
  overrides: Pick<AiSignInSession, "provider" | "state"> &
    Partial<AiSignInSession>,
): AiSignInSession {
  return {
    verificationUrl: null,
    userCode: null,
    needsCode: false,
    startedAt: "2026-11-17T10:00:00.000Z",
    expiresAt: "2026-11-17T10:15:00.000Z",
    message: null,
    ...overrides,
  };
}

const findCard = (label: "Claude" | "ChatGPT") =>
  screen.findByRole("region", { name: `${label} account` });
const getCard = (label: "Claude" | "ChatGPT") =>
  screen.getByRole("region", { name: `${label} account` });

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

describe("AiAccountPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    vi.mocked(api.updateSettings).mockResolvedValue({} as never);
  });

  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: originalScrollIntoView,
    });
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("shows both accounts signed out and starts a Claude sign-in for the chosen account kind", async () => {
    vi.mocked(api.getAiAccountOverview).mockResolvedValue(overview());
    vi.mocked(api.startAiSignIn).mockResolvedValue(
      session({
        provider: "claude",
        state: "waiting_for_code",
        verificationUrl: "https://claude.ai/oauth/authorize?code=true",
        needsCode: true,
      }),
    );

    renderWithQueryClient(<AiAccountPanel />);

    const claude = await findCard("Claude");
    const chatgpt = getCard("ChatGPT");
    expect(within(claude).getByText("Not signed in")).toBeInTheDocument();
    expect(within(chatgpt).getByText("Not signed in")).toBeInTheDocument();
    expect(within(claude).getByText("In use")).toBeInTheDocument();
    // An account must be signed in before Boussole can switch to it.
    expect(
      within(chatgpt).queryByRole("button", { name: "Use ChatGPT" }),
    ).not.toBeInTheDocument();
    // No ChatGPT model list from the server: the model is typed instead.
    expect(
      within(chatgpt).getByRole("textbox", { name: "ChatGPT model" }),
    ).toHaveValue("");

    fireEvent.click(
      within(claude).getByRole("button", { name: "Sign in with Claude" }),
    );
    expect(
      within(claude).getByRole("button", { name: /Anthropic Console/ }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(claude).getByRole("button", { name: /Claude Pro or Max plan/ }),
    );

    await waitFor(() =>
      expect(api.startAiSignIn).toHaveBeenCalledWith({
        provider: "claude",
        mode: "subscription",
      }),
    );
    expect(
      await within(claude).findByRole("link", {
        name: "Open Anthropic sign-in",
      }),
    ).toHaveAttribute("href", "https://claude.ai/oauth/authorize?code=true");
  });

  it("sends the pasted Claude code and confirms once the sign-in completes", async () => {
    const waiting = session({
      provider: "claude",
      state: "waiting_for_code",
      verificationUrl: "https://claude.ai/oauth/authorize?code=true",
      needsCode: true,
    });
    vi.mocked(api.getAiAccountOverview).mockResolvedValue(
      overview({ signIn: waiting }),
    );
    vi.mocked(api.submitAiSignInCode).mockResolvedValue({
      ...waiting,
      state: "completing",
      needsCode: false,
    });

    const { queryClient } = renderWithQueryClient(<AiAccountPanel />);

    const claude = await findCard("Claude");
    const link = within(claude).getByRole("link", {
      name: "Open Anthropic sign-in",
    });
    expect(link).toHaveAttribute(
      "href",
      "https://claude.ai/oauth/authorize?code=true",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      within(claude).getByText("Sign in, then copy the code shown."),
    ).toBeInTheDocument();

    const finish = within(claude).getByRole("button", { name: "Finish" });
    expect(finish).toBeDisabled();
    fireEvent.change(
      within(claude).getByRole("textbox", { name: "Code from Anthropic" }),
      { target: { value: "  abc123#state  " } },
    );
    fireEvent.click(finish);

    await waitFor(() =>
      expect(api.submitAiSignInCode).toHaveBeenCalledWith("abc123#state"),
    );
    expect(
      await within(claude).findByText("Checking your sign-in…"),
    ).toBeInTheDocument();

    // The server finishes; the next check sees it.
    vi.mocked(api.getAiAccountOverview).mockResolvedValue(
      overview({
        accounts: {
          claude: account("claude", {
            signedIn: true,
            accountLabel: "nora@example.com",
            planLabel: "Claude Max",
          }),
          chatgpt: account("chatgpt"),
        },
        signIn: { ...waiting, state: "completed", message: "Signed in." },
      }),
    );
    await act(() =>
      queryClient.refetchQueries({ queryKey: queryKeys.aiAccount.overview() }),
    );

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Signed in"),
    );
    expect(api.getAiAccountOverview).toHaveBeenCalledWith({ fresh: true });
    expect(
      await within(claude).findByText("Signed in as nora@example.com"),
    ).toBeInTheDocument();
    expect(within(claude).getByText("Claude Max")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("shows the ChatGPT code to enter on OpenAI's page, copies it and can cancel", async () => {
    vi.mocked(api.getAiAccountOverview).mockResolvedValue(
      overview({
        models: { claude: CLAUDE_MODELS, chatgpt: CHATGPT_MODELS },
        signIn: session({
          provider: "chatgpt",
          state: "waiting_for_approval",
          verificationUrl: "https://auth.openai.com/codex/device",
          userCode: "ABCD-1234",
        }),
      }),
    );
    vi.mocked(api.cancelAiSignIn).mockResolvedValue(
      session({
        provider: "chatgpt",
        state: "cancelled",
        message: "Sign-in cancelled.",
      }),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderWithQueryClient(<AiAccountPanel />);

    const chatgpt = await findCard("ChatGPT");
    expect(within(chatgpt).getByText("ABCD-1234")).toBeInTheDocument();
    const link = within(chatgpt).getByRole("link", {
      name: "Open OpenAI sign-in",
    });
    expect(link).toHaveAttribute(
      "href",
      "https://auth.openai.com/codex/device",
    );
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      within(chatgpt).getByText("Waiting for you to approve…"),
    ).toBeInTheDocument();
    // One sign-in at a time.
    expect(
      within(getCard("Claude")).getByRole("button", {
        name: "Sign in with Claude",
      }),
    ).toBeDisabled();

    fireEvent.click(within(chatgpt).getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ABCD-1234"));
    expect(
      await within(chatgpt).findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();

    fireEvent.click(within(chatgpt).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(api.cancelAiSignIn).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(within(chatgpt).queryByText("ABCD-1234")).not.toBeInTheDocument(),
    );
    expect(
      within(chatgpt).getByRole("button", { name: "Sign in with ChatGPT" }),
    ).toBeEnabled();
  });

  it("shows the signed-in account and saves the chosen models and account", async () => {
    vi.mocked(api.getAiAccountOverview).mockResolvedValue(
      overview({
        accounts: {
          claude: account("claude", {
            signedIn: true,
            accountLabel: "nora@example.com",
            planLabel: "Claude Max",
          }),
          chatgpt: account("chatgpt", {
            signedIn: true,
            planLabel: "ChatGPT plan",
          }),
        },
        models: { claude: CLAUDE_MODELS, chatgpt: CHATGPT_MODELS },
      }),
    );

    renderWithQueryClient(<AiAccountPanel />);

    const claude = await findCard("Claude");
    expect(
      within(claude).getByText("Signed in as nora@example.com"),
    ).toBeInTheDocument();
    expect(within(claude).getByText("Claude Max")).toBeInTheDocument();
    expect(
      within(claude).getByRole("combobox", { name: "Claude model" }),
    ).toHaveTextContent("Claude Opus");
    expect(
      within(claude).getByRole("combobox", { name: "Claude effort" }),
    ).toHaveTextContent("Medium");

    fireEvent.click(
      within(claude).getByRole("combobox", { name: "Claude model" }),
    );
    fireEvent.click(
      await screen.findByRole("option", { name: /^Claude Sonnet/ }),
    );
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({
        model: "sonnet:medium",
      }),
    );
    expect(
      within(claude).getByRole("combobox", { name: "Claude model" }),
    ).toHaveTextContent("Claude Sonnet");

    fireEvent.click(
      within(claude).getByRole("combobox", { name: "Claude effort" }),
    );
    fireEvent.click(await screen.findByRole("option", { name: /^High/ }));
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({ model: "sonnet:high" }),
    );
    expect(toast.success).toHaveBeenCalledWith("Model saved");

    const chatgpt = getCard("ChatGPT");
    expect(
      within(chatgpt).getByRole("combobox", { name: "ChatGPT model" }),
    ).toHaveTextContent("ChatGPT's default");
    fireEvent.click(
      within(chatgpt).getByRole("combobox", { name: "ChatGPT model" }),
    );
    fireEvent.click(await screen.findByRole("option", { name: /^GPT Codex/ }));
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({
        chatgptModel: "gpt-codex:medium",
      }),
    );

    fireEvent.click(
      within(chatgpt).getByRole("button", { name: "Use ChatGPT" }),
    );
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({
        aiProvider: "chatgpt",
      }),
    );
    expect(await within(chatgpt).findByText("In use")).toBeInTheDocument();
    expect(within(claude).queryByText("In use")).not.toBeInTheDocument();
  });

  it("saves a typed ChatGPT model when the server lists none", async () => {
    vi.mocked(api.getAiAccountOverview).mockResolvedValue(overview());

    renderWithQueryClient(<AiAccountPanel />);

    const chatgpt = await findCard("ChatGPT");
    const field = within(chatgpt).getByRole("textbox", {
      name: "ChatGPT model",
    });
    fireEvent.change(field, { target: { value: " gpt-codex:high " } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({
        chatgptModel: "gpt-codex:high",
      }),
    );
  });

  it("shows the server's Claude login with a way to use your own account", async () => {
    vi.mocked(api.getAiAccountOverview).mockResolvedValue(
      overview({
        accounts: {
          claude: account("claude", {
            signedIn: true,
            usesServerLogin: true,
            planLabel: "Claude Max",
          }),
          chatgpt: account("chatgpt", {
            available: false,
            message: "The ChatGPT (Codex) CLI is not installed on this server.",
          }),
        },
      }),
    );

    renderWithQueryClient(<AiAccountPanel />);

    const claude = await findCard("Claude");
    expect(
      within(claude).getByText("Using the server's Claude login"),
    ).toBeInTheDocument();
    expect(
      within(claude).queryByRole("button", { name: "Sign out" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(claude).getByRole("button", {
        name: "Sign in with your own account",
      }),
    );
    expect(
      within(claude).getByRole("button", { name: /Claude Pro or Max plan/ }),
    ).toBeInTheDocument();

    const chatgpt = getCard("ChatGPT");
    expect(
      within(chatgpt).getByText("Not installed on this server"),
    ).toBeInTheDocument();
    expect(
      within(chatgpt).queryByRole("button", { name: /Sign in/ }),
    ).not.toBeInTheDocument();
    expect(within(chatgpt).queryByText(/CLI/)).not.toBeInTheDocument();
  });

  it("asks before signing out, then refreshes the account", async () => {
    vi.mocked(api.getAiAccountOverview).mockResolvedValue(
      overview({
        accounts: {
          claude: account("claude", {
            signedIn: true,
            accountLabel: "nora@example.com",
          }),
          chatgpt: account("chatgpt"),
        },
      }),
    );
    vi.mocked(api.signOutAiAccount).mockResolvedValue({ signedOut: true });
    const onAccountChange = vi.fn();

    renderWithQueryClient(<AiAccountPanel onAccountChange={onAccountChange} />);

    const claude = await findCard("Claude");
    fireEvent.click(within(claude).getByRole("button", { name: "Sign out" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Sign out of Claude?")).toBeInTheDocument();
    expect(api.signOutAiAccount).not.toHaveBeenCalled();

    vi.mocked(api.getAiAccountOverview).mockResolvedValue(overview());
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));

    await waitFor(() =>
      expect(api.signOutAiAccount).toHaveBeenCalledWith("claude"),
    );
    await waitFor(() => expect(onAccountChange).toHaveBeenCalledTimes(1));
    expect(api.getAiAccountOverview).toHaveBeenCalledWith({ fresh: true });
    expect(
      await within(claude).findByText("Not signed in"),
    ).toBeInTheDocument();
  });

  it("shows why a sign-in failed and starts it again", async () => {
    vi.mocked(api.getAiAccountOverview).mockResolvedValue(
      overview({
        signIn: session({
          provider: "chatgpt",
          state: "failed",
          message: "Device sign-in is turned off for this ChatGPT account.",
        }),
      }),
    );
    vi.mocked(api.startAiSignIn).mockResolvedValue(
      session({
        provider: "chatgpt",
        state: "waiting_for_approval",
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "WXYZ-9876",
        startedAt: "2026-11-17T10:05:00.000Z",
      }),
    );

    renderWithQueryClient(<AiAccountPanel />);

    const chatgpt = await findCard("ChatGPT");
    expect(within(chatgpt).getByRole("alert")).toHaveTextContent(
      "Device sign-in is turned off for this ChatGPT account.",
    );
    fireEvent.click(within(chatgpt).getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(api.startAiSignIn).toHaveBeenCalledWith({ provider: "chatgpt" }),
    );
    expect(await within(chatgpt).findByText("WXYZ-9876")).toBeInTheDocument();
    expect(within(chatgpt).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps checking while ChatGPT waits for approval, then uses it when Claude is not signed in", async () => {
    const waiting = session({
      provider: "chatgpt",
      state: "waiting_for_approval",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234",
    });
    vi.mocked(api.getAiAccountOverview).mockResolvedValue(
      overview({ signIn: waiting }),
    );
    const onAccountChange = vi.fn();

    renderWithQueryClient(<AiAccountPanel onAccountChange={onAccountChange} />);

    expect(
      await within(await findCard("ChatGPT")).findByText("ABCD-1234"),
    ).toBeInTheDocument();
    expect(api.getAiAccountOverview).toHaveBeenCalledTimes(1);

    // Approved on OpenAI's page: the next 2-second check sees it.
    vi.mocked(api.getAiAccountOverview).mockResolvedValue(
      overview({
        accounts: {
          claude: account("claude"),
          chatgpt: account("chatgpt", {
            signedIn: true,
            planLabel: "ChatGPT plan",
          }),
        },
        signIn: { ...waiting, state: "completed", message: "Signed in." },
      }),
    );

    await waitFor(
      () =>
        expect(toast.success).toHaveBeenCalledWith("Signed in", {
          description: "Boussole now uses ChatGPT.",
        }),
      { timeout: 5000 },
    );
    expect(api.getAiAccountOverview).toHaveBeenCalledWith({ fresh: true });
    expect(api.updateSettings).toHaveBeenCalledWith({ aiProvider: "chatgpt" });
    expect(onAccountChange).toHaveBeenCalledTimes(1);
    expect(
      await within(getCard("ChatGPT")).findByText("In use"),
    ).toBeInTheDocument();
  });
});
