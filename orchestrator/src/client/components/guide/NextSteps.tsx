import type {
  GuideStep,
  GuideStepAction,
  GuideStepKind,
} from "@shared/types.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Compass,
  FileText,
  ListChecks,
  Loader2,
  Mail,
  Mic,
  RefreshCw,
  Search,
} from "lucide-react";
import type React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import * as api from "@/client/api";
import { useQueryErrorToast } from "@/client/hooks/useQueryErrorToast";
import { showErrorToast } from "@/client/lib/error-toast";
import { queryKeys } from "@/client/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ICONS: Record<
  GuideStepKind,
  React.ComponentType<{ className?: string }>
> = {
  add_cv: FileText,
  prepare_interview: Mic,
  follow_up: Mail,
  continue_application: ListChecks,
  search_running: Loader2,
  find_jobs: Search,
  recalculate_scores: RefreshCw,
  choose_job: Compass,
  caught_up: CheckCircle2,
};

type RunAction = (step: GuideStep, cta: GuideStepAction) => void;

function ActionButton({
  step,
  cta,
  variant,
  size,
  busy,
  onRun,
}: {
  step: GuideStep;
  cta: GuideStepAction;
  variant: "default" | "outline" | "ghost";
  size: "default" | "sm";
  busy: boolean;
  onRun: RunAction;
}) {
  if (cta.action) {
    return (
      <Button
        size={size}
        variant={variant}
        disabled={busy}
        onClick={() => onRun(step, cta)}
      >
        {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        {busy && cta.action === "recalculate" ? "Recalculating…" : cta.label}
      </Button>
    );
  }
  return (
    <Button size={size} variant={variant} asChild>
      <Link to={cta.href ?? "/"}>
        {cta.label}
        {variant === "ghost" ? null : <ArrowRight className="ml-1.5 h-4 w-4" />}
      </Link>
    </Button>
  );
}

/** "Your next step" (one big card) and up to three smaller steps after it. */
export const NextSteps: React.FC = () => {
  const queryClient = useQueryClient();
  const stepsQuery = useQuery({
    queryKey: queryKeys.jobs.guideNextSteps(),
    queryFn: api.getGuideNextSteps,
    refetchInterval: (query) =>
      query.state.data?.steps.some((step) => step.kind === "search_running")
        ? 15_000
        : 60_000,
  });
  useQueryErrorToast(stepsQuery.error, "Could not load your next step.");

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });

  const recalculate = useMutation({
    mutationFn: (jobIds: string[]) => api.rescoreJob(jobIds),
    onSuccess: async (result) => {
      toast.success(
        `${result.succeeded} match ${result.succeeded === 1 ? "score" : "scores"} recalculated`,
        result.failed > 0
          ? {
              description: `${result.failed} could not be scored. Try again later.`,
            }
          : undefined,
      );
      await refresh();
    },
    onError: (error) =>
      showErrorToast(error, "Could not recalculate the scores."),
  });

  const followUpSent = useMutation({
    mutationFn: (jobId: string) => api.logFollowUpSent(jobId),
    onSuccess: async () => {
      toast.success("Follow-up logged on the job's timeline");
      await refresh();
    },
    onError: (error) => showErrorToast(error, "Could not log the follow-up."),
  });

  const run: RunAction = (step, cta) => {
    if (cta.action === "recalculate") recalculate.mutate(cta.jobIds ?? []);
    if (cta.action === "log_follow_up" && step.jobId) {
      followUpSent.mutate(step.jobId);
    }
  };
  const isBusy = (step: GuideStep, cta: GuideStepAction) =>
    (cta.action === "recalculate" && recalculate.isPending) ||
    (cta.action === "log_follow_up" &&
      followUpSent.isPending &&
      followUpSent.variables === step.jobId);

  if (stepsQuery.isLoading) {
    return (
      <section
        aria-label="Loading your next step"
        className="rounded-2xl border border-border/60 bg-card/60 p-6"
      >
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </section>
    );
  }
  const [primary, ...after] = stepsQuery.data?.steps ?? [];
  if (!primary) return null;
  const PrimaryIcon = ICONS[primary.kind];

  return (
    <div className="space-y-3">
      <section
        aria-labelledby="next-step-title"
        className="rounded-2xl border border-primary/40 bg-card/70 p-5 shadow-sm sm:p-6"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Your next step
        </p>
        <div className="mt-3 flex items-start gap-4">
          <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary sm:flex">
            <PrimaryIcon
              className={cn(
                "h-5 w-5",
                primary.kind === "search_running" && "animate-spin",
              )}
            />
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <h2
              id="next-step-title"
              className="font-display text-2xl font-bold leading-tight"
            >
              {primary.title}
            </h2>
            <p className="max-w-prose text-sm leading-6 text-muted-foreground">
              {primary.detail}
            </p>
            {primary.cta.action === "recalculate" && recalculate.isPending ? (
              <p className="text-xs text-muted-foreground">
                Your AI account scores each job; this takes a few minutes. You
                can leave this page.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <ActionButton
                step={primary}
                cta={primary.cta}
                variant="default"
                size="default"
                busy={isBusy(primary, primary.cta)}
                onRun={run}
              />
              {primary.secondary ? (
                <ActionButton
                  step={primary}
                  cta={primary.secondary}
                  variant="ghost"
                  size="default"
                  busy={isBusy(primary, primary.secondary)}
                  onRun={run}
                />
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {after.length > 0 ? (
        <section
          aria-labelledby="after-that-title"
          className="rounded-2xl border border-border/50 bg-card/40 px-4 py-3"
        >
          <h3
            id="after-that-title"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            After that
          </h3>
          <ul className="divide-y divide-border/40">
            {after.map((step) => {
              const Icon = ICONS[step.kind];
              return (
                <li
                  key={`${step.kind}-${step.jobId ?? ""}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="text-sm font-medium">{step.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {step.detail}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {step.secondary ? (
                      <ActionButton
                        step={step}
                        cta={step.secondary}
                        variant="ghost"
                        size="sm"
                        busy={isBusy(step, step.secondary)}
                        onRun={run}
                      />
                    ) : null}
                    <ActionButton
                      step={step}
                      cta={step.cta}
                      variant="outline"
                      size="sm"
                      busy={isBusy(step, step.cta)}
                      onRun={run}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
};
