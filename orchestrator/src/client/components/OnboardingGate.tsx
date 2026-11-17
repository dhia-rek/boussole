import { useOnboardingRequirement } from "@client/hooks/useOnboardingRequirement";
import type React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { isPublicPath } from "../lib/public-paths";

export const OnboardingGate: React.FC = () => {
  const location = useLocation();

  if (
    location.pathname === "/onboarding" ||
    location.pathname === "/sign-in" ||
    isPublicPath(location.pathname)
  ) {
    return null;
  }

  return <OnboardingRedirect />;
};

const OnboardingRedirect: React.FC = () => {
  const { checking, complete } = useOnboardingRequirement();

  if (checking || complete) {
    return null;
  }

  return <Navigate to="/onboarding" replace />;
};
