import * as api from "@client/api";
import { usePipelineLiveStatus } from "@client/hooks/usePipelineLiveStatus";
import { formatRelativeTime } from "@client/lib/relative-time";
import { ArrowRight, Loader2, Play, Square } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  describeLastRun,
  describeProgress,
  progressFraction,
  RUN_PIPELINE_PATH,
  RUN_STATUS_DOT,
  RUN_STATUS_LABELS,
  STEP_LABELS,
} from "./pipeline-status";

/** Thin app-wide bar showing what the pipeline is doing right now. */
export const PipelineStatusBar: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The jobs page has its own run/cancel controls and progress card.
  const onJobsPage = pathname === "/jobs" || pathname.startsWith("/jobs/");
  const { status, progress, isRunning, isLoading } = usePipelineLiveStatus();
  const [isCancelling, setIsCancelling] = useState(false);

  const handleCancel = async () => {
    setIsCancelling(true);
    try {
      await api.cancelPipeline();
      toast.message("Stopping the pipeline…");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not stop the pipeline",
      );
    } finally {
      setIsCancelling(false);
    }
  };

  const lastRun = status?.lastRun ?? null;
  const needsAttention = progress?.step === "challenge_required";
  const fraction = progress ? progressFraction(progress) : null;
  const dotColor = needsAttention ? "bg-amber-400" : "bg-primary";

  return (
    <div className="sticky top-0 z-40 h-10 shrink-0 border-b border-border/60 bg-background/85 backdrop-blur-md">
      <div className="container mx-auto flex h-full items-center gap-3 px-4 text-xs">
        <output
          aria-live="polite"
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          {isRunning ? (
            <>
              <span className="relative flex h-2 w-2 shrink-0">
                <span
                  className={cn(
                    "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
                    dotColor,
                  )}
                />
                <span
                  className={cn(
                    "relative inline-flex h-2 w-2 rounded-full",
                    dotColor,
                  )}
                />
              </span>
              <span className="shrink-0 font-medium text-foreground">
                {progress
                  ? (STEP_LABELS[progress.step] ?? "Pipeline running")
                  : "Pipeline running"}
              </span>
              {progress ? (
                <span className="truncate text-muted-foreground">
                  {describeProgress(progress)}
                </span>
              ) : null}
            </>
          ) : isLoading ? (
            <span className="text-muted-foreground">Checking pipeline…</span>
          ) : lastRun ? (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  RUN_STATUS_DOT[lastRun.status],
                )}
              />
              <span className="sr-only">
                {RUN_STATUS_LABELS[lastRun.status]}:
              </span>
              <span className="truncate text-muted-foreground">
                {describeLastRun(lastRun)}
              </span>
              {status?.nextScheduledRun ? (
                <span className="hidden shrink-0 text-muted-foreground md:inline">
                  · next run {formatRelativeTime(status.nextScheduledRun)}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">No pipeline run yet</span>
          )}
        </output>

        <div className="flex shrink-0 items-center gap-1">
          {isRunning ? (
            <>
              {onJobsPage ? null : (
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                >
                  <Link to="/jobs/ready">
                    {needsAttention ? "Solve" : "Details"}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => void handleCancel()}
                disabled={isCancelling}
              >
                {isCancelling ? (
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Square className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Stop
              </Button>
            </>
          ) : onJobsPage ? null : (
            <Button
              type="button"
              size="sm"
              aria-label="Run pipeline"
              className="h-7 gap-1.5 px-2.5 text-xs"
              onClick={() => navigate(RUN_PIPELINE_PATH)}
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Run pipeline</span>
            </Button>
          )}
        </div>
      </div>
      {isRunning && fraction !== null ? (
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5">
          <div
            className="h-full bg-primary transition-[width] duration-500"
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
};
