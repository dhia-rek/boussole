import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Compass,
  ExternalLink,
  Loader2,
  MapPin,
  Sparkles,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import * as api from "@/client/api";
import { useQueryErrorToast } from "@/client/hooks/useQueryErrorToast";
import { showErrorToast } from "@/client/lib/error-toast";
import { queryKeys } from "@/client/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageHeader, PageMain } from "../components/layout";

function scoreTone(score: number): string {
  if (score >= 80)
    return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400";
  if (score >= 60)
    return "border-amber-500/50 text-amber-600 dark:text-amber-400";
  return "border-border text-muted-foreground";
}

/**
 * "Choose your next application": good, fresh matches, one at a time.
 * Apply, skip for good, or decide later.
 */
export const ReviewPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reviewQuery = useQuery({
    queryKey: queryKeys.jobs.guideReview(),
    queryFn: api.getGuideReview,
    // Fresh on every visit; within a visit, `seen` keeps the position stable.
    refetchOnMount: "always",
  });
  useQueryErrorToast(reviewQuery.error, "Could not load your matches.");
  // Jobs already decided on in this session (applied, skipped or later).
  const [seen, setSeen] = useState<string[]>([]);

  const skip = useMutation({
    mutationFn: (jobId: string) => api.skipJob(jobId),
    onSuccess: (job) => {
      toast.success(`Skipped ${job.employer}. It won't be suggested again.`);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.guideNextSteps(),
      });
    },
    onError: (error, jobId) => {
      setSeen((ids) => ids.filter((id) => id !== jobId));
      showErrorToast(error, "Could not skip this job.");
    },
  });

  const items = reviewQuery.data ?? [];
  const remaining = items.filter((item) => !seen.includes(item.id));
  const current = remaining[0];
  const total = seen.length + remaining.length;
  const position = seen.length + 1;

  const header = (
    <PageHeader
      icon={Compass}
      title="Choose your next application"
      subtitle="One job at a time"
    />
  );

  if (reviewQuery.isLoading) {
    return (
      <>
        {header}
        <PageMain className="max-w-2xl">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </PageMain>
      </>
    );
  }

  if (!current) {
    const sawSome = seen.length > 0;
    return (
      <>
        {header}
        <PageMain className="max-w-2xl">
          <section className="space-y-3 rounded-2xl border border-border/60 bg-card/60 p-6">
            <h2 className="font-display text-xl font-bold">
              {sawSome ? "That's all of them" : "No good new matches right now"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {sawSome
                ? "You went through every good match from your recent searches."
                : "Matches show up here when a recent search finds jobs that score 60 or more with a real AI score."}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild>
                <Link to="/today">
                  Back to Today <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/jobs/ready?run=automatic">Search for more jobs</Link>
              </Button>
            </div>
          </section>
        </PageMain>
      </>
    );
  }

  const next = () => setSeen((ids) => [...ids, current.id]);

  return (
    <>
      {header}
      <PageMain className="max-w-2xl space-y-4">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Job {position} of {total}
          </p>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${Math.round((position / total) * 100)}%` }}
            />
          </div>
        </div>

        <article
          aria-labelledby="review-job-title"
          className="space-y-4 rounded-2xl border border-border/60 bg-card/70 p-5 shadow-sm sm:p-6"
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2
                id="review-job-title"
                className="font-display text-2xl font-bold leading-tight"
              >
                {current.title}
              </h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {current.employer}
                </span>
                {current.location ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                    {current.location}
                  </span>
                ) : null}
              </p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-sm font-semibold tabular-nums",
                scoreTone(current.score),
              )}
              title="Match score"
            >
              {current.score}
              <span className="sr-only"> out of 100</span>
            </span>
          </div>

          {current.roleSummary ? (
            <div className="space-y-1">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                The role
              </h3>
              <p className="text-sm leading-6">{current.roleSummary}</p>
            </div>
          ) : null}

          {current.reason ? (
            <div className="space-y-1">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Why it matches you
              </h3>
              <p className="flex gap-2 text-sm leading-6 text-foreground/85">
                <Sparkles
                  className="mt-1 h-3.5 w-3.5 shrink-0 text-primary/75"
                  aria-hidden="true"
                />
                {current.reason}
              </p>
            </div>
          ) : null}

          <Link
            to={`/job/${current.id}`}
            className="inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
          >
            Read the whole job
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </article>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => navigate(`/apply/${current.id}?step=cv`)}>
            Apply to this one <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              next();
              skip.mutate(current.id);
            }}
          >
            Not for me
          </Button>
          <Button variant="ghost" onClick={next}>
            Decide later
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          "Not for me" moves the job to Skipped; "Decide later" keeps it for
          next time.
        </p>
      </PageMain>
    </>
  );
};
