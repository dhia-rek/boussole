import { PageHeader, StatusIndicator } from "@client/components/layout";
import type { JobSource } from "@shared/types.js";
import { LayoutDashboard, Link2, Loader2, Play, Square } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";

interface OrchestratorHeaderProps {
  isPipelineRunning: boolean;
  isCancelling: boolean;
  pipelineSources: JobSource[];
  onOpenAutomaticRun: () => void;
  onCancelPipeline: () => void;
  /** Import one job from a link; available even while a search runs. */
  onOpenManualImport: () => void;
}

export const OrchestratorHeader: React.FC<OrchestratorHeaderProps> = ({
  isPipelineRunning,
  isCancelling,
  pipelineSources,
  onOpenAutomaticRun,
  onCancelPipeline,
  onOpenManualImport,
}) => {
  const runAction = isPipelineRunning ? (
    <Button
      size="sm"
      onClick={onCancelPipeline}
      disabled={isCancelling}
      variant="destructive"
      className="gap-2"
    >
      {isCancelling ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Square className="h-4 w-4" />
      )}
      <span className="hidden sm:inline">
        {isCancelling ? `Cancelling (${pipelineSources.length})` : `Cancel run`}
      </span>
    </Button>
  ) : (
    <Button size="sm" onClick={onOpenAutomaticRun} className="gap-2">
      <Play className="h-4 w-4" />
      <span className="hidden sm:inline">Run pipeline</span>
    </Button>
  );
  const actions = (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={onOpenManualImport}
        className="gap-2"
        aria-label="Add a job from a link"
      >
        <Link2 className="h-4 w-4" />
        <span className="hidden sm:inline">Add a job</span>
      </Button>
      {runAction}
    </div>
  );

  return (
    <PageHeader
      icon={LayoutDashboard}
      title="Jobs"
      subtitle="Review, tailor and apply"
      statusIndicator={
        isPipelineRunning ? (
          <StatusIndicator label="Pipeline running" variant="amber" />
        ) : undefined
      }
      actions={actions}
    />
  );
};
