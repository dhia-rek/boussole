import type {
  CvCheck,
  CvCheckLineReview,
  CvCheckVerdict,
} from "@shared/types.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileSearch,
  Loader2,
  PencilLine,
  RefreshCw,
  Scissors,
} from "lucide-react";
import React from "react";
import * as api from "@/client/api";
import { useQueryErrorToast } from "@/client/hooks/useQueryErrorToast";
import { showErrorToast } from "@/client/lib/error-toast";
import { queryKeys } from "@/client/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const POLL_MS = 3000;

const VERDICT_LABELS: Record<CvCheckVerdict, string> = {
  keep: "Fits this job",
  reword: "Reword for this job",
  cut: "Not it for this job",
};

const VERDICT_STYLES: Record<CvCheckVerdict, string> = {
  keep: "border-l-emerald-500/60",
  reword: "border-l-amber-500/80",
  cut: "border-l-rose-500/80",
};

const VerdictIcon: React.FC<{ verdict: CvCheckVerdict }> = ({ verdict }) => {
  const className = "mt-0.5 h-3.5 w-3.5 shrink-0";
  if (verdict === "keep") {
    return (
      <CheckCircle2
        className={cn(className, "text-emerald-600 dark:text-emerald-400")}
        aria-hidden
      />
    );
  }
  if (verdict === "reword") {
    return (
      <PencilLine
        className={cn(className, "text-amber-600 dark:text-amber-300")}
        aria-hidden
      />
    );
  }
  return (
    <Scissors
      className={cn(className, "text-rose-600 dark:text-rose-400")}
      aria-hidden
    />
  );
};

export const CvCheckCard: React.FC<{ jobId: string }> = ({ jobId }) => {
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = React.useState(false);
  const [focusRef, setFocusRef] = React.useState<string | null>(null);

  // Jump to a referenced line: reveal it if hidden, scroll to it, highlight it.
  React.useEffect(() => {
    if (!focusRef) return;
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`cv-line-${focusRef}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => setFocusRef(null), 2500);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusRef]);
  const checkQuery = useQuery<CvCheck | null>({
    queryKey: queryKeys.jobs.cvCheck(jobId),
    queryFn: () => api.getCvCheck(jobId),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? POLL_MS : false,
  });
  useQueryErrorToast(checkQuery.error, "Could not load the CV check.");

  const startMutation = useMutation({
    mutationFn: () => api.startCvCheck(jobId),
    onSuccess: (check) => {
      queryClient.setQueryData(queryKeys.jobs.cvCheck(jobId), check);
    },
    onError: (error) => {
      showErrorToast(error, "Could not start the CV check.");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.cvCheck(jobId),
      });
    },
  });

  const check = checkQuery.data ?? null;
  const running = check?.status === "running" || startMutation.isPending;

  return (
    <section
      className="rounded-xl border border-border/50 bg-card/75 p-4"
      aria-labelledby="cv-check-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="cv-check-title"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <FileSearch className="h-4 w-4 text-primary" />
            CV check
          </h2>
          {check?.result && <SummaryLine check={check} />}
        </div>
        {!running && (
          <Button
            size="sm"
            variant={check ? "outline" : "default"}
            onClick={() => startMutation.mutate()}
            disabled={checkQuery.isLoading}
          >
            {check ? (
              <>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                {check.status === "failed" ? "Try again" : "Check again"}
              </>
            ) : (
              <>
                <FileSearch className="mr-1.5 h-3.5 w-3.5" />
                Check my CV
              </>
            )}
          </Button>
        )}
      </div>

      {!check && !running && (
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          Reads your CV line by line against this job: what fits, what to
          reword, what is not it for this job, and what the job asks for that
          your CV doesn't show. Suggestions only reuse what your CV already
          says. Your CV is not changed.
        </p>
      )}

      {running && (
        <output className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading your CV against this job. This usually takes under a minute.
        </output>
      )}

      {!running && check?.status === "failed" && (
        <p className="mt-3 flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            {check.error ?? "The CV check failed."}
            {check.result && " The previous check is shown below."}
          </span>
        </p>
      )}

      {check?.result && (
        <div className={cn(running && "opacity-60")} aria-busy={running}>
          <CheckBody
            check={check}
            showAll={showAll}
            onToggleShowAll={() => setShowAll((value) => !value)}
            focusRef={focusRef}
            onGoToLine={(ref) => {
              const line = check.result?.lines.find((item) => item.ref === ref);
              if (line?.verdict === "keep") setShowAll(true);
              setFocusRef(ref);
            }}
          />
        </div>
      )}
    </section>
  );
};

const SummaryLine: React.FC<{ check: CvCheck }> = ({ check }) => {
  const lines = check.result?.lines ?? [];
  const count = (verdict: CvCheckVerdict) =>
    lines.filter((line) => line.verdict === verdict).length;
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {check.cvTitle ?? "Your CV"}
      {check.cvLanguage ? ` (${check.cvLanguage.toUpperCase()})` : ""} ·{" "}
      {count("keep")} fit · {count("reword")} to reword · {count("cut")} not it
      · {check.result?.missing.length ?? 0} missing
    </p>
  );
};

const LineItem: React.FC<{
  line: CvCheckLineReview;
  highlighted: boolean;
}> = ({ line, highlighted }) => (
  <li
    id={`cv-line-${line.ref}`}
    className={cn(
      "scroll-mt-24 rounded-md border border-border/40 border-l-4 bg-background/30 p-3 transition-shadow",
      VERDICT_STYLES[line.verdict],
      highlighted && "ring-2 ring-primary",
    )}
  >
    <div className="flex gap-2">
      <VerdictIcon verdict={line.verdict} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
          <span className="font-mono">{line.ref}</span>
          {line.entry && <span className="truncate">{line.entry}</span>}
          <span className="sr-only">{VERDICT_LABELS[line.verdict]}</span>
        </div>
        <p
          className={cn(
            "leading-6",
            line.verdict === "cut" &&
              "text-foreground/70 line-through decoration-rose-500/50",
          )}
        >
          {line.text}
        </p>
        {line.suggestion && (
          <p className="flex gap-1.5 leading-6">
            <ArrowRight className="mt-1.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
            <span className="font-medium">{line.suggestion}</span>
          </p>
        )}
        {line.newTerms.length > 0 && (
          <p className="flex gap-1.5 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Not in your CV: {line.newTerms.join(", ")}. Use this wording only
              if it is true.
            </span>
          </p>
        )}
        {line.reason && (
          <p className="text-xs text-muted-foreground">{line.reason}</p>
        )}
      </div>
    </div>
  </li>
);

/** Turns "L12" style references into buttons that jump to that CV line. */
const RefText: React.FC<{
  text: string;
  knownRefs: ReadonlySet<string>;
  onGoToLine: (ref: string) => void;
}> = ({ text, knownRefs, onGoToLine }) => {
  const parts = text.split(/\b(L\d{1,3})\b/);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 && knownRefs.has(part) ? (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: parts of one string
            key={index}
            type="button"
            onClick={() => onGoToLine(part)}
            className="rounded bg-primary/10 px-1 font-mono text-[0.85em] text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`Go to CV line ${part}`}
          >
            {part}
          </button>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of one string
          <React.Fragment key={index}>{part}</React.Fragment>
        ),
      )}
    </>
  );
};

const CheckBody: React.FC<{
  check: CvCheck;
  showAll: boolean;
  onToggleShowAll: () => void;
  focusRef: string | null;
  onGoToLine: (ref: string) => void;
}> = ({ check, showAll, onToggleShowAll, focusRef, onGoToLine }) => {
  const result = check.result;
  const knownRefs = React.useMemo(
    () => new Set((result?.lines ?? []).map((line) => line.ref)),
    [result],
  );
  if (!result) return null;
  const byRef = new Map(result.lines.map((line) => [line.ref, line]));
  const visible = showAll
    ? result.lines
    : result.lines.filter((line) => line.verdict !== "keep");
  const sections: Array<{ title: string; lines: CvCheckLineReview[] }> = [];
  for (const line of visible) {
    const last = sections.at(-1);
    if (last && last.title === line.sectionTitle) last.lines.push(line);
    else sections.push({ title: line.sectionTitle, lines: [line] });
  }

  return (
    <div className="mt-4 space-y-5 text-sm">
      {check.cvChanged && (
        <p className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
          Your CV changed since this check. Click "Check again" for an
          up-to-date review.
        </p>
      )}

      {(result.unreviewedCount ?? 0) + (result.skippedLineCount ?? 0) > 0 && (
        <p className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
          <span>
            {(result.unreviewedCount ?? 0) > 0 &&
              `The review skipped ${result.unreviewedCount} line${result.unreviewedCount === 1 ? "" : "s"}; they are shown as fitting. `}
            {(result.skippedLineCount ?? 0) > 0 &&
              `Your CV is long: the last ${result.skippedLineCount} line${result.skippedLineCount === 1 ? " was" : "s were"} not reviewed.`}
          </span>
        </p>
      )}

      {result.overall && (
        <p className="rounded-lg bg-muted/50 p-3 leading-6">
          <RefText
            text={result.overall}
            knownRefs={knownRefs}
            onGoToLine={onGoToLine}
          />
        </p>
      )}

      {result.priorities.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Change first
          </h3>
          <ol className="list-decimal space-y-1.5 pl-5 leading-6">
            {result.priorities.map((priority, index) => (
              <li key={`${index}-${priority}`}>
                <RefText
                  text={priority}
                  knownRefs={knownRefs}
                  onGoToLine={onGoToLine}
                />
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {showAll ? "Every line of your CV" : "Lines to look at"}
          </h3>
          <Button size="sm" variant="ghost" onClick={onToggleShowAll}>
            {showAll
              ? "Only lines to look at"
              : `Show all ${result.lines.length} lines`}
          </Button>
        </div>
        {visible.length === 0 ? (
          <p className="text-muted-foreground">
            Every line fits this job as written.
          </p>
        ) : (
          sections.map((section, index) => (
            <div key={`${index}-${section.title}`} className="space-y-2">
              <h4 className="text-xs font-semibold">{section.title}</h4>
              <ul className="space-y-2">
                {section.lines.map((line) => (
                  <LineItem
                    key={line.ref}
                    line={line}
                    highlighted={focusRef === line.ref}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      {result.missing.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            The job asks, your CV doesn't show
          </h3>
          <ul className="space-y-2">
            {result.missing.map((gap, index) => (
              <li key={`${index}-${gap.requirement}`} className="leading-6">
                <span className="font-medium">{gap.requirement}</span>
                {gap.note && (
                  <p className="text-xs text-muted-foreground">
                    <RefText
                      text={gap.note}
                      knownRefs={knownRefs}
                      onGoToLine={onGoToLine}
                    />
                  </p>
                )}
                {gap.closestRef && byRef.get(gap.closestRef) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Closest in your CV:{" "}
                    <RefText
                      text={gap.closestRef}
                      knownRefs={knownRefs}
                      onGoToLine={onGoToLine}
                    />{" "}
                    <span className="italic">
                      “{byRef.get(gap.closestRef)?.text}”
                    </span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
