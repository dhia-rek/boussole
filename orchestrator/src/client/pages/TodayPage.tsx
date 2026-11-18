import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, Home, Play, Search } from "lucide-react";
import type React from "react";
import { Link, useNavigate } from "react-router-dom";
import { queryKeys } from "@/client/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import * as api from "../api";
import {
  describeProgress,
  displaySource,
  progressFraction,
  RUN_PIPELINE_PATH,
  RUN_STATUS_DOT,
  RUN_STATUS_LABELS,
  STEP_LABELS,
} from "../components/app-shell/pipeline-status";
import { BoussoleMark } from "../components/brand/BoussoleMark";
import { NextSteps } from "../components/guide/NextSteps";
import { PageHeader, PageMain, SectionCard } from "../components/layout";
import { usePipelineLiveStatus } from "../hooks/usePipelineLiveStatus";
import { useProfile } from "../hooks/useProfile";
import { useSettings } from "../hooks/useSettings";
import { formatDuration, formatRelativeTime } from "../lib/relative-time";

const MAX_TERM_CHIPS = 12;

const CardTitle: React.FC<{
  title: string;
  action?: React.ReactNode;
}> = ({ title, action }) => (
  <div className="mb-3 flex items-center justify-between gap-2">
    <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
    {action}
  </div>
);

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** First name from the CV, or null for the "Resume" placeholder. */
export function firstNameOf(
  personName: string | null | undefined,
): string | null {
  const name = personName?.trim();
  if (!name || name === "Resume") return null;
  return name.split(/\s+/)[0] ?? null;
}

const TodayGreeting: React.FC = () => {
  const { personName } = useProfile();
  const firstName = firstNameOf(personName);
  const greeting = greetingFor(new Date().getHours());
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border/60 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(155,147,255,0.18),transparent_55%),radial-gradient(90%_120%_at_0%_100%,rgba(255,107,87,0.12),transparent_60%)] px-6 py-6 sm:px-8">
      <BoussoleMark className="boussole-needle pointer-events-none absolute -right-8 -top-8 size-24 text-brand-periwinkle/20 sm:-right-6 sm:-top-10 sm:size-36" />
      <h2 className="relative pr-16 font-display text-[clamp(1.6rem,3vw,2.2rem)] font-extrabold leading-[1.05] tracking-[-0.035em] sm:pr-0">
        {greeting}
        {firstName ? `, ${firstName}` : ""}.
      </h2>
      <p className="relative mt-2 text-sm text-muted-foreground">
        One step at a time. Here is what to do now.
      </p>
    </section>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
      {label}
    </div>
    <div className="text-base font-semibold tabular-nums">{value}</div>
  </div>
);

const PipelineCard: React.FC<{ className?: string }> = ({ className }) => {
  const navigate = useNavigate();
  const { status, progress, isRunning, isLoading } = usePipelineLiveStatus();
  const lastRun = status?.lastRun ?? null;
  const insightsQuery = useQuery({
    queryKey: queryKeys.pipeline.runInsights(lastRun?.id ?? "none"),
    queryFn: () => api.getPipelineRunInsights(lastRun?.id ?? ""),
    enabled: Boolean(lastRun && !isRunning),
  });
  const savedDetails = insightsQuery.data?.savedDetails ?? null;
  const sourceErrors = savedDetails?.resultSummary.sourceErrors ?? null;
  const sources = lastRun?.configSnapshot?.sources ?? [];
  const fraction = progress ? progressFraction(progress) : null;

  return (
    <SectionCard className={className}>
      <CardTitle
        title="Pipeline"
        action={
          isRunning ? (
            <Button
              asChild
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-xs"
            >
              <Link to="/jobs/ready">
                Details{" "}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => navigate(RUN_PIPELINE_PATH)}
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" /> Run pipeline
            </Button>
          )
        }
      />

      {isRunning ? (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">
              {progress
                ? (STEP_LABELS[progress.step] ?? "Running")
                : "Pipeline running"}
            </p>
            {progress ? (
              <p className="text-xs text-muted-foreground">
                {describeProgress(progress)}
              </p>
            ) : null}
          </div>
          {fraction !== null ? (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${Math.round(fraction * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : isLoading ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted/40" />
      ) : lastRun ? (
        <div className="space-y-4">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span
              aria-hidden="true"
              className={cn(
                "h-2 w-2 rounded-full",
                RUN_STATUS_DOT[lastRun.status],
              )}
            />
            <span className="font-medium">
              {RUN_STATUS_LABELS[lastRun.status]}
            </span>
            <span className="text-muted-foreground">
              {formatRelativeTime(lastRun.completedAt ?? lastRun.startedAt)}
              {lastRun.completedAt
                ? ` · took ${formatDuration(
                    Date.parse(lastRun.completedAt) -
                      Date.parse(lastRun.startedAt),
                  )}`
                : ""}
            </span>
          </p>
          {lastRun.status === "failed" && lastRun.errorMessage ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {lastRun.errorMessage}
            </p>
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Found" value={lastRun.jobsDiscovered} />
            <Stat label="Tailored" value={lastRun.jobsProcessed} />
            <Stat label="Sources" value={sources.length || "–"} />
          </div>
          {sources.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {sources.map((source) => (
                <span
                  key={source}
                  className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {displaySource(source)}
                </span>
              ))}
            </div>
          ) : null}
          <div className="text-xs">
            {sourceErrors === null ? (
              <p className="text-muted-foreground">
                Per-source results weren't recorded for this run.
              </p>
            ) : sourceErrors.length === 0 ? (
              <p className="text-emerald-400">Every source responded.</p>
            ) : (
              <div className="space-y-1">
                <p className="font-medium text-amber-300">
                  {sourceErrors.length} source
                  {sourceErrors.length === 1 ? "" : "s"} had problems
                </p>
                <ul className="space-y-1 text-muted-foreground">
                  {sourceErrors.slice(0, 4).map((error) => (
                    <li key={error} className="line-clamp-2">
                      {error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {status?.nextScheduledRun
              ? `Next automatic run ${formatRelativeTime(status.nextScheduledRun)}.`
              : "No automatic run scheduled."}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          The pipeline hasn't run yet. Run it to find, score and tailor jobs.
        </p>
      )}
    </SectionCard>
  );
};

const SearchSetupCard: React.FC = () => {
  const { settings, isLoading } = useSettings();
  const terms = settings?.searchTerms?.value ?? [];
  const country = settings?.jobspyCountryIndeed?.value ?? "";
  const cities = settings?.searchCities?.value ?? "";
  const location = [cities, country]
    .filter(Boolean)
    .join(", ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return (
    <SectionCard>
      <CardTitle
        title="Your search"
        action={
          <Link
            to="/settings"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Edit
          </Link>
        }
      />
      {isLoading ? (
        <div className="h-16 animate-pulse rounded-lg bg-muted/40" />
      ) : (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            {terms.length} search term{terms.length === 1 ? "" : "s"}
            {location ? ` · ${location}` : ""}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {terms.slice(0, MAX_TERM_CHIPS).map((term) => (
              <span
                key={term}
                className="rounded-full border border-border/60 bg-muted/20 px-2 py-0.5 text-xs"
              >
                {term}
              </span>
            ))}
            {terms.length > MAX_TERM_CHIPS ? (
              <span className="px-1 py-0.5 text-xs text-muted-foreground">
                +{terms.length - MAX_TERM_CHIPS} more
              </span>
            ) : null}
          </div>
        </div>
      )}
    </SectionCard>
  );
};

/** The last search and the search setup, folded away until wanted. */
const SearchDetails: React.FC = () => (
  <details className="group rounded-2xl border border-border/50 bg-card/30">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
      Search details
      <ChevronDown
        className="h-4 w-4 transition-transform group-open:rotate-180"
        aria-hidden="true"
      />
    </summary>
    <div className="grid gap-4 px-4 pb-4 lg:grid-cols-2">
      <PipelineCard />
      <SearchSetupCard />
    </div>
  </details>
);

export const TodayPage: React.FC = () => {
  const subtitle = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <>
      <PageHeader icon={Home} title="Today" subtitle={subtitle} />
      <PageMain className="max-w-3xl">
        <TodayGreeting />
        <NextSteps />
        <SearchDetails />
      </PageMain>
    </>
  );
};
