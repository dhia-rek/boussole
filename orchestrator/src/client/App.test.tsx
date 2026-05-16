import { render, screen } from "@testing-library/react";
import type React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useDemoInfo } from "./hooks/useDemoInfo";

vi.mock("./hooks/useDemoInfo", () => ({
  useDemoInfo: vi.fn(),
}));

vi.mock("react-transition-group", () => ({
  SwitchTransition: ({ children }: { children: React.ReactNode }) => children,
  CSSTransition: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/ui/sonner", () => ({
  Toaster: () => null,
}));

vi.mock("./components/OnboardingGate", () => ({
  OnboardingGate: () => null,
}));

vi.mock("./pages/GmailOauthCallbackPage", () => ({
  GmailOauthCallbackPage: () => null,
}));

vi.mock("./pages/HomePage", () => ({
  HomePage: () => <div>overview</div>,
}));

vi.mock("./pages/InProgressBoardPage", () => ({
  InProgressBoardPage: () => null,
}));

vi.mock("./pages/JobPage", () => ({
  JobPage: () => null,
}));

vi.mock("./pages/OnboardingPage", () => ({
  OnboardingPage: () => <div>onboarding</div>,
}));

vi.mock("./pages/OrchestratorPage", () => ({
  OrchestratorPage: () => null,
}));

vi.mock("./pages/SettingsPage", () => ({
  SettingsPage: () => null,
}));

vi.mock("./pages/SignInPage", () => ({
  SignInPage: () => <div>sign-in</div>,
}));

vi.mock("./pages/TrackingInboxPage", () => ({
  TrackingInboxPage: () => null,
}));

vi.mock("./pages/VisaSponsorsPage", () => ({
  VisaSponsorsPage: () => null,
}));

describe("App demo banner", () => {
  it("shows the demo banner in demo mode", () => {
    vi.mocked(useDemoInfo).mockReturnValue({
      demoMode: true,
      resetCadenceHours: 6,
      lastResetAt: null,
      nextResetAt: null,
      baselineVersion: null,
      baselineName: null,
    });

    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText(/demo mode/i)).toBeInTheDocument();
    expect(screen.getByText(/6 hours/i)).toBeInTheDocument();
  });

  it("does not show the demo banner when demo mode is disabled", () => {
    vi.mocked(useDemoInfo).mockReturnValue({
      demoMode: false,
      resetCadenceHours: 6,
      lastResetAt: null,
      nextResetAt: null,
      baselineVersion: null,
      baselineName: null,
    });

    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.queryByText(/demo mode/i)).toBeNull();
  });

  it("does not fetch demo info while rendering the sign-in page", () => {
    vi.mocked(useDemoInfo).mockReturnValue(null);

    render(
      <MemoryRouter initialEntries={["/sign-in"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText("sign-in")).toBeInTheDocument();
    expect(useDemoInfo).toHaveBeenCalledWith({ enabled: false });
  });
});
