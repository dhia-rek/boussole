import type React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShellProvider } from "./AppShellContext";
import { AppSidebar } from "./AppSidebar";
import { MobileNav } from "./MobileNav";
import { PipelineStatusBar } from "./PipelineStatusBar";

/**
 * Height of the pipeline status bar. Sticky page headers read it through
 * `--app-header-offset` so they stop right below the bar.
 */
const SHELL_STYLE = { "--app-header-offset": "2.5rem" } as React.CSSProperties;

/** Sidebar + live pipeline bar around every signed-in page. */
export const AppShell: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <AppShellProvider>
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-dvh">
        <AppSidebar />
        <div
          className="relative flex min-w-0 flex-1 flex-col pb-[calc(4rem_+_env(safe-area-inset-bottom))] lg:pb-0"
          style={SHELL_STYLE}
        >
          <PipelineStatusBar />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
        <MobileNav />
      </div>
    </TooltipProvider>
  </AppShellProvider>
);
