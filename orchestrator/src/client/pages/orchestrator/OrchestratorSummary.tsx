import { PipelineProgress } from "@client/components";
import { useWelcomeMessage } from "@client/hooks/useWelcomeMessage";
import type { JobStatus } from "@shared/types.js";
import type React from "react";

interface OrchestratorSummaryProps {
  stats: Record<JobStatus, number>;
  isPipelineRunning: boolean;
}

export const OrchestratorSummary: React.FC<OrchestratorSummaryProps> = ({
  stats,
  isPipelineRunning,
}) => {
  const welcomeText = useWelcomeMessage();
  const total = Object.values(stats).reduce((a, b) => a + b, 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-1">
        <p className="text-2xl font-semibold tracking-tight text-foreground">
          {welcomeText}
        </p>
        {total > 0 && (
          <p className="text-sm text-muted-foreground">
            {stats.ready ?? 0} ready to apply · {stats.applied ?? 0} applied ·{" "}
            {total} total
          </p>
        )}
      </div>

      {isPipelineRunning && (
        <div className="max-w-3xl">
          <PipelineProgress isRunning={isPipelineRunning} />
        </div>
      )}
    </section>
  );
};
