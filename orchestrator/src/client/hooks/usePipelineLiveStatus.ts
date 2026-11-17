import type {
  PipelineProgressState,
  PipelineProgressStep,
  PipelineStatusResponse,
} from "@shared/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { queryKeys } from "@/client/lib/queryKeys";
import * as api from "../api";

const ACTIVE_STEPS = new Set<PipelineProgressStep>([
  "crawling",
  "challenge_required",
  "importing",
  "scoring",
  "processing",
]);

const RUNNING_STATUS_POLL_MS = 5_000;
const IDLE_STATUS_POLL_MS = 30_000;
const PROGRESS_POLL_MS = 2_500;

export interface PipelineLiveStatus {
  status: PipelineStatusResponse | null;
  /** Latest progress snapshot while a run is active. */
  progress: PipelineProgressState | null;
  isRunning: boolean;
  isLoading: boolean;
}

/**
 * Pipeline state for the app-wide status bar. Polls instead of opening
 * another event stream: the jobs page already keeps one open, and browsers
 * cap concurrent connections per host.
 */
export function usePipelineLiveStatus(): PipelineLiveStatus {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: queryKeys.pipeline.status(),
    queryFn: api.getPipelineStatus,
    refetchInterval: (query) =>
      query.state.data?.isRunning
        ? RUNNING_STATUS_POLL_MS
        : IDLE_STATUS_POLL_MS,
  });
  const isRunning = statusQuery.data?.isRunning === true;

  const progressQuery = useQuery({
    queryKey: queryKeys.pipeline.progressSnapshot(),
    queryFn: api.getPipelineProgressSnapshot,
    enabled: isRunning,
    refetchInterval: isRunning ? PROGRESS_POLL_MS : false,
  });

  // When a run ends, refresh everything that depends on its results.
  const wasRunning = useRef(isRunning);
  useEffect(() => {
    if (wasRunning.current && !isRunning) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pipeline.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    }
    wasRunning.current = isRunning;
  }, [isRunning, queryClient]);

  const progress =
    isRunning && progressQuery.data && ACTIVE_STEPS.has(progressQuery.data.step)
      ? progressQuery.data
      : null;

  return {
    status: statusQuery.data ?? null,
    progress,
    isRunning,
    isLoading: statusQuery.isLoading,
  };
}
