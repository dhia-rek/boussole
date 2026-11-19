import { PipelineProgress } from "@client/components";
import type { JobStatus } from "@shared/types.js";
import type React from "react";

interface OrchestratorSummaryProps {
  stats: Record<JobStatus, number>;
  isPipelineRunning: boolean;
}

/** Counts and live search progress (the greeting lives on Today). */
export const OrchestratorSummary: React.FC<OrchestratorSummaryProps> = ({
  stats,
  isPipelineRunning,
}) => {
  const total = Object.values(stats).reduce((a, b) => a + b, 0);

  if (total === 0 && !isPipelineRunning) return null;
  return (
    <section className="space-y-4">
      {total > 0 && (
        <p className="text-sm text-muted-foreground">
          {stats.ready ?? 0} ready to apply · {stats.applied ?? 0} applied ·{" "}
          {total} total
        </p>
      )}

      {isPipelineRunning && (
        <div className="max-w-3xl">
          <PipelineProgress isRunning={isPipelineRunning} />
        </div>
      )}
    </section>
  );
};
