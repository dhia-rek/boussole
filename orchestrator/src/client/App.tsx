/**
 * Main App component.
 */

import React, { useEffect, useRef } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { CSSTransition, SwitchTransition } from "react-transition-group";

import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "./components/app-shell/AppShell";
import { OnboardingGate } from "./components/OnboardingGate";
import { useDemoInfo } from "./hooks/useDemoInfo";
import { setAuthNavigator } from "./lib/auth-navigation";
import { DesignResumePage } from "./pages/DesignResumePage";
import { GmailOauthCallbackPage } from "./pages/GmailOauthCallbackPage";
import { HomePage } from "./pages/HomePage";
import { InProgressBoardPage } from "./pages/InProgressBoardPage";
import { JobPage } from "./pages/JobPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { OrchestratorPage } from "./pages/OrchestratorPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage } from "./pages/SignInPage";
import { SpontaneousPage } from "./pages/SpontaneousPage";
import { TodayPage } from "./pages/TodayPage";
import { TracerLinksPage } from "./pages/TracerLinksPage";
import { TrackingInboxPage } from "./pages/TrackingInboxPage";
import { VisaSponsorsPage } from "./pages/VisaSponsorsPage";

/** Backwards-compatibility redirects: old URL paths -> new URL paths */
const REDIRECTS: Array<{ from: string; to: string }> = [
  { from: "/", to: "/today" },
  { from: "/home", to: "/overview" },
  { from: "/ready", to: "/jobs/ready" },
  { from: "/ready/:jobId", to: "/jobs/ready/:jobId" },
  { from: "/discovered", to: "/jobs/discovered" },
  { from: "/discovered/:jobId", to: "/jobs/discovered/:jobId" },
  { from: "/applied", to: "/jobs/applied" },
  { from: "/applied/:jobId", to: "/jobs/applied/:jobId" },
  { from: "/in-progress", to: "/applications/in-progress" },
  { from: "/in-progress/:jobId", to: "/applications/in-progress" },
  { from: "/jobs/in_progress", to: "/applications/in-progress" },
  { from: "/jobs/in_progress/:jobId", to: "/applications/in-progress" },
  { from: "/all", to: "/jobs/all" },
  { from: "/all/:jobId", to: "/jobs/all/:jobId" },
];

/** Full-screen pages rendered without the sidebar and pipeline bar. */
const SHELL_FREE_PATHS = ["/sign-in", "/onboarding", "/oauth/gmail/callback"];

export function isShellFreePath(pathname: string): boolean {
  return SHELL_FREE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export const App: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const nodeRef = useRef<HTMLDivElement>(null);
  const isSignInPage = location.pathname === "/sign-in";
  const withShell = !isShellFreePath(location.pathname);
  const demoInfo = useDemoInfo({ enabled: !isSignInPage });
  const showDemoBanners = !isSignInPage && demoInfo?.demoMode;

  // Determine a stable key for transitions to avoid unnecessary unmounts when switching sub-tabs
  const pageKey = React.useMemo(() => {
    const firstSegment = location.pathname.split("/")[1] || "jobs";
    if (firstSegment === "jobs") {
      return "orchestrator";
    }
    return firstSegment;
  }, [location.pathname]);

  useEffect(() => {
    setAuthNavigator((nextPath) => {
      const search = new URLSearchParams();
      if (
        nextPath &&
        nextPath !== "/sign-in" &&
        !nextPath.startsWith("/sign-in?")
      ) {
        search.set("next", nextPath);
      }
      navigate(`/sign-in${search.toString() ? `?${search.toString()}` : ""}`, {
        replace: true,
      });
    });

    return () => {
      setAuthNavigator(null);
    };
  }, [navigate]);

  const pageRoutes = (
    <SwitchTransition mode="out-in">
      <CSSTransition
        key={pageKey}
        nodeRef={nodeRef}
        timeout={100}
        classNames="page"
        unmountOnExit
      >
        <div ref={nodeRef}>
          <Routes location={location}>
            {/* Backwards-compatibility redirects */}
            {REDIRECTS.map(({ from, to }) => (
              <Route
                key={from}
                path={from}
                element={<Navigate to={to} replace />}
              />
            ))}

            {/* Application routes */}
            <Route path="/today" element={<TodayPage />} />
            <Route path="/overview" element={<HomePage />} />
            <Route
              path="/oauth/gmail/callback"
              element={<GmailOauthCallbackPage />}
            />
            <Route path="/job/:id" element={<JobPage />} />
            <Route path="/job/:id/:view" element={<JobPage />} />
            <Route
              path="/applications/in-progress"
              element={<InProgressBoardPage />}
            />
            <Route path="/design-resume" element={<DesignResumePage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/sign-in" element={<SignInPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/tracer-links" element={<TracerLinksPage />} />
            <Route path="/visa-sponsors" element={<VisaSponsorsPage />} />
            <Route path="/spontaneous" element={<SpontaneousPage />} />
            <Route path="/tracking-inbox" element={<TrackingInboxPage />} />
            <Route path="/jobs/:tab" element={<OrchestratorPage />} />
            <Route path="/jobs/:tab/:jobId" element={<OrchestratorPage />} />
          </Routes>
        </div>
      </CSSTransition>
    </SwitchTransition>
  );

  return (
    <>
      <OnboardingGate />
      {showDemoBanners && (
        <div className="sticky top-0 z-50 w-full border-b border-amber-400/50 bg-amber-500/20 px-4 py-2 text-xs text-amber-100 shadow-sm backdrop-blur">
          <p className="text-center font-medium">
            Demo mode: integrations are simulated and data resets every{" "}
            {demoInfo.resetCadenceHours} hours.
          </p>
        </div>
      )}
      <div className="min-h-screen" style={{ background: "var(--color-bg)" }}>
        {withShell ? <AppShell>{pageRoutes}</AppShell> : pageRoutes}
      </div>

      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
};
