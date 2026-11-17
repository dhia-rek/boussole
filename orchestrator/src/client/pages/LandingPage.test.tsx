import { screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasAuthenticatedSession } from "../api/auth-session";
import { useDemoInfo } from "../hooks/useDemoInfo";
import { renderWithQueryClient } from "../test/renderWithQueryClient";
import { LandingPage, resolveDemoTarget } from "./LandingPage";

vi.mock("../hooks/useDemoInfo", () => ({ useDemoInfo: vi.fn() }));
vi.mock("../api/auth-session", () => ({ hasAuthenticatedSession: vi.fn() }));

function demoInfo(demoMode: boolean) {
  return {
    demoMode,
    resetCadenceHours: 6,
    lastResetAt: null,
    nextResetAt: null,
    baselineVersion: null,
    baselineName: null,
  };
}

function renderLanding() {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={["/welcome"]}>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe("resolveDemoTarget", () => {
  it("opens this instance when it is the demo, else the configured demo, else nothing", () => {
    expect(resolveDemoTarget(true, null)).toEqual({
      kind: "internal",
      to: "/today",
    });
    expect(resolveDemoTarget(false, "https://demo.example")).toEqual({
      kind: "external",
      href: "https://demo.example",
    });
    expect(resolveDemoTarget(false, null)).toBeNull();
  });
});

describe("LandingPage", () => {
  beforeEach(() => {
    vi.mocked(hasAuthenticatedSession).mockReturnValue(false);
  });

  it("pitches Boussole in French and leads the demo visitor into the app", () => {
    vi.mocked(useDemoInfo).mockReturnValue(demoInfo(true));
    renderLanding();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /Arrêtez de chercher\..*Commencez à viser\./,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Vous postulez partout. Personne ne répond.",
      }),
    ).toBeInTheDocument();
    const steps = screen.getByRole("heading", {
      name: "Trois étapes, chaque jour, sans vous.",
    }).parentElement as HTMLElement;
    expect(within(steps).getAllByRole("listitem")).toHaveLength(3);

    for (const link of screen.getAllByRole("link", { name: /Voir la démo/ })) {
      expect(link).toHaveAttribute("href", "/today");
    }
    expect(
      screen.getAllByRole("link", { name: "Se connecter" })[0],
    ).toHaveAttribute("href", "/sign-in");
  });

  it("hides the demo button on a private instance without a public demo", () => {
    vi.mocked(useDemoInfo).mockReturnValue(demoInfo(false));
    renderLanding();
    expect(screen.queryByRole("link", { name: /Voir la démo/ })).toBeNull();
  });

  it("offers to open the app when already signed in", () => {
    vi.mocked(useDemoInfo).mockReturnValue(demoInfo(false));
    vi.mocked(hasAuthenticatedSession).mockReturnValue(true);
    renderLanding();
    expect(
      screen.getAllByRole("link", { name: "Ouvrir Boussole" })[0],
    ).toHaveAttribute("href", "/today");
    expect(screen.queryByRole("link", { name: "Se connecter" })).toBeNull();
  });
});
