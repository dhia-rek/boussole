import { isKeywordEstimate } from "@shared/scoring";
import type { Job, JobBrief } from "@shared/types.js";
import { CircleHelp, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type React from "react";
import { useRescoreJob } from "@/client/hooks/useRescoreJob";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type JobBriefPaneProps = {
  job: Job;
  className?: string;
  /** Also show the match score and its reason above the brief. */
  showFit?: boolean;
};

export const JobBriefPane: React.FC<JobBriefPaneProps> = ({
  job,
  className,
  showFit = false,
}) => {
  const brief = parseJobBrief(job.jobBrief);

  if (!brief) {
    return (
      <section
        className={cn(
          "rounded-lg border border-border/45 bg-muted/5 px-4 py-3",
          className,
        )}
      >
        <FitLine job={job} />
        <p className="mt-2 text-xs text-muted-foreground">
          Recalculate the match to get a short summary of this job.
        </p>
      </section>
    );
  }

  return (
    <section className={cn("space-y-4", className)}>
      {showFit ? <FitLine job={job} /> : null}
      <p className="text-lg font-bold leading-7 text-foreground border-border p-4 rounded-lg bg-muted/50 flex items-center gap-2">
        {brief.role_summary}
      </p>

      <div className="grid gap-y-6 gap-x-2 lg:grid-cols-2">
        <BulletSection title="Company offers" items={brief.company_offers} />
        <BulletSection title="They want" items={brief.they_want} />
        <BulletSection
          title="Missing or unclear"
          items={brief.missing_or_unclear}
        />

        {brief.specifics.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Highlights
            </div>
            <div className="flex flex-wrap gap-1.5">
              {brief.specifics.map((item) => (
                <span
                  key={item}
                  className="whitespace-nowrap inline-flex items-center text-foreground bg-muted/50 rounded-lg px-2 py-1"
                >
                  <span className="truncate">{item}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

const FitLine: React.FC<{ job: Job }> = ({ job }) => {
  if (!job.suitabilityReason) return null;
  if (isKeywordEstimate(job.suitabilityReason))
    return <EstimateLine job={job} />;

  return (
    <div className="flex gap-2 rounded-md border border-primary/15 bg-background/35 p-4 leading-5 text-foreground/85">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/75" />
      <span>
        {job.suitabilityScore != null && (
          <span className="font-semibold tabular-nums">
            {job.suitabilityScore}/100:{" "}
          </span>
        )}
        {job.suitabilityReason}
      </span>
    </div>
  );
};

/** The score is a keyword estimate: say so, and offer a real AI score. */
const EstimateLine: React.FC<{ job: Job }> = ({ job }) => {
  const { isRescoring, rescoreJob } = useRescoreJob(() => undefined);
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-md border border-dashed border-muted-foreground/40 bg-background/35 p-4 leading-5">
      <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">
          {job.suitabilityScore != null && (
            <span className="tabular-nums">≈{job.suitabilityScore}/100: </span>
          )}
          Keyword estimate, not an AI score
        </p>
        <p className="text-sm text-muted-foreground">
          Your AI account could not score this job when it was found, so this
          number only counts generic keywords. Recalculate it to get a real
          match score and explanation.
        </p>
      </div>
      <Button
        size="sm"
        onClick={() => void rescoreJob(job.id)}
        disabled={isRescoring}
      >
        {isRescoring ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        )}
        {isRescoring ? "Scoring…" : "Recalculate match"}
      </Button>
    </div>
  );
};

const BulletSection: React.FC<{ title: string; items: string[] }> = ({
  title,
  items,
}) => {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="space-y-1.5 leading-6 text-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-foreground/45" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export function parseJobBrief(value: string | null): JobBrief | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<JobBrief>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.role_summary !== "string") return null;

    return {
      role_summary: parsed.role_summary,
      they_want: toStringList(parsed.they_want),
      specifics: toStringList(parsed.specifics),
      company_offers: toStringList(parsed.company_offers),
      practical_details: toStringList(parsed.practical_details),
      missing_or_unclear: toStringList(parsed.missing_or_unclear),
      repeated_signals: toStringList(parsed.repeated_signals),
    };
  } catch {
    return null;
  }
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
