import { describe, expect, it } from "vitest";
import {
  hasSavedSearchTermsOnboarding,
  isOnboardingComplete,
} from "./onboarding";

describe("onboarding helpers", () => {
  it("does not need a basic-auth decision to finish (real accounts replace it)", () => {
    expect(
      isOnboardingComplete({
        demoMode: false,
        settings: {
          basicAuthActive: false,
          onboardingBasicAuthDecision: null,
          searchTerms: { value: ["data"], default: [], override: ["data"] },
        } as never,
        llmValid: true,
        baseResumeValid: true,
      }),
    ).toBe(true);
  });

  it("requires an explicit saved search-terms override by default", () => {
    expect(
      hasSavedSearchTermsOnboarding({
        searchTerms: {
          value: ["Platform Engineer"],
          default: ["Software Engineer"],
          override: ["Platform Engineer"],
        },
      } as any),
    ).toBe(true);

    expect(
      isOnboardingComplete({
        demoMode: false,
        settings: {
          basicAuthActive: false,
          onboardingBasicAuthDecision: "skipped",
          searchTerms: {
            value: ["Software Engineer"],
            default: ["Software Engineer"],
            override: null,
          },
        } as any,
        llmValid: true,
        baseResumeValid: true,
      }),
    ).toBe(false);
  });

  it("allows the flow to override search-term completion with session state", () => {
    expect(
      isOnboardingComplete({
        demoMode: false,
        settings: {
          basicAuthActive: false,
          onboardingBasicAuthDecision: "skipped",
          searchTerms: {
            value: ["Platform Engineer"],
            default: ["Software Engineer"],
            override: ["Platform Engineer"],
          },
        } as any,
        llmValid: true,
        baseResumeValid: true,
        searchTermsValid: false,
      }),
    ).toBe(false);
  });

  it("requires all onboarding validations when not in demo mode", () => {
    expect(
      isOnboardingComplete({
        demoMode: false,
        settings: {
          basicAuthActive: false,
          onboardingBasicAuthDecision: "skipped",
          searchTerms: {
            value: ["Platform Engineer"],
            default: ["Software Engineer"],
            override: ["Platform Engineer"],
          },
        } as any,
        llmValid: true,
        baseResumeValid: false,
      }),
    ).toBe(false);

    expect(
      isOnboardingComplete({
        demoMode: false,
        settings: {
          basicAuthActive: false,
          onboardingBasicAuthDecision: "skipped",
          searchTerms: {
            value: ["Platform Engineer"],
            default: ["Software Engineer"],
            override: ["Platform Engineer"],
          },
        } as any,
        llmValid: true,
        baseResumeValid: true,
      }),
    ).toBe(true);
  });
});
