import type {
  CompanyResearch,
  CompanyResearchFact,
  CompanyResearchFactCheck,
  CompanyResearchTopic,
} from "@shared/types.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  Loader2,
  RefreshCw,
  Telescope,
} from "lucide-react";
import type React from "react";
import * as api from "@/client/api";
import { useQueryErrorToast } from "@/client/hooks/useQueryErrorToast";
import { showErrorToast } from "@/client/lib/error-toast";
import { queryKeys } from "@/client/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const POLL_MS = 4000;

const TOPIC_LABELS: Record<CompanyResearchTopic, string> = {
  company: "Company",
  product: "Products",
  market: "Market",
  size: "Size",
  news: "News",
  culture: "How they work",
  role: "The role",
};

const CHECK_LABELS: Record<CompanyResearchFactCheck, string> = {
  verified: "Quote found on the source page",
  not_found: "Quote not found on the source page",
  unreachable: "Source page could not be read",
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const CompanyResearchCard: React.FC<{ jobId: string }> = ({ jobId }) => {
  const queryClient = useQueryClient();
  const researchQuery = useQuery<CompanyResearch | null>({
    queryKey: queryKeys.jobs.research(jobId),
    queryFn: () => api.getCompanyResearch(jobId),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? POLL_MS : false,
  });
  useQueryErrorToast(researchQuery.error, "Could not load company research.");

  const startMutation = useMutation({
    mutationFn: () => api.startCompanyResearch(jobId),
    onSuccess: (research) => {
      queryClient.setQueryData(queryKeys.jobs.research(jobId), research);
    },
    onError: (error) => {
      showErrorToast(error, "Could not start the research.");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.research(jobId),
      });
    },
  });

  const research = researchQuery.data ?? null;
  const running = research?.status === "running" || startMutation.isPending;

  return (
    <section
      className="rounded-xl border border-border/50 bg-card/75 p-4"
      aria-labelledby="company-research-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="company-research-title"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <Telescope className="h-4 w-4 text-primary" />
            Company research
          </h2>
          {research?.brief && research.judgement && (
            <JudgementLine research={research} />
          )}
        </div>
        {!running && (
          <Button
            size="sm"
            variant={research ? "outline" : "default"}
            onClick={() => startMutation.mutate()}
            disabled={researchQuery.isLoading}
          >
            {research ? (
              <>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                {research.status === "failed" ? "Try again" : "Research again"}
              </>
            ) : (
              <>
                <Telescope className="mr-1.5 h-3.5 w-3.5" />
                Research company
              </>
            )}
          </Button>
        )}
      </div>

      {!research && !running && (
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          Searches the web with your AI account for what this company does, its
          news and what the role involves. Boussole then opens every source and
          checks the quoted words are really there. Only confirmed facts reach
          Ghostwriter.
        </p>
      )}

      {running && (
        <output className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Researching and checking sources. This usually takes 1 to 4 minutes;
          you can leave this page.
        </output>
      )}

      {!running && research?.status === "failed" && (
        <p className="mt-3 flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            {research.error ?? "The research failed."}
            {research.brief && " The previous brief is shown below."}
          </span>
        </p>
      )}

      {research?.brief && (
        <div className={cn(running && "opacity-60")} aria-busy={running}>
          <ResearchBody research={research} />
        </div>
      )}
    </section>
  );
};

const JudgementLine: React.FC<{ research: CompanyResearch }> = ({
  research,
}) => {
  const judgement = research.judgement;
  if (!judgement) return null;
  const passed = research.verdict === "passed";
  const scores = [
    judgement.relevance != null ? `relevance ${judgement.relevance}/5` : null,
    judgement.specificity != null
      ? `specificity ${judgement.specificity}/5`
      : null,
  ].filter(Boolean);
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
          passed
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            : "bg-amber-500/15 text-amber-800 dark:text-amber-200",
        )}
      >
        {passed ? (
          <CheckCircle2 className="h-3 w-3" />
        ) : (
          <AlertTriangle className="h-3 w-3" />
        )}
        {passed ? "Passed" : "Needs review"}
      </span>
      <span>
        {judgement.verifiedCount} of {judgement.factCount} facts confirmed on
        their source
        {scores.length > 0 ? ` · ${scores.join(" · ")}` : ""}
      </span>
    </p>
  );
};

const CheckIcon: React.FC<{ check: CompanyResearchFactCheck }> = ({
  check,
}) => {
  const label = CHECK_LABELS[check];
  const className = "mt-1 h-3.5 w-3.5 shrink-0";
  if (check === "verified") {
    return (
      <CheckCircle2
        className={cn(className, "text-emerald-600 dark:text-emerald-400")}
        aria-label={label}
      >
        <title>{label}</title>
      </CheckCircle2>
    );
  }
  if (check === "not_found") {
    return (
      <AlertTriangle
        className={cn(className, "text-amber-600 dark:text-amber-300")}
        aria-label={label}
      >
        <title>{label}</title>
      </AlertTriangle>
    );
  }
  return (
    <CircleHelp
      className={cn(className, "text-muted-foreground")}
      aria-label={label}
    >
      <title>{label}</title>
    </CircleHelp>
  );
};

const FactItem: React.FC<{ fact: CompanyResearchFact }> = ({ fact }) => (
  <li className="flex gap-2">
    <CheckIcon check={fact.check} />
    <div className="min-w-0 space-y-1">
      <p
        className={cn(
          "leading-6",
          fact.check !== "verified" && "text-foreground/70",
        )}
      >
        {fact.claim}
      </p>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">
          <a
            href={fact.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {hostOf(fact.sourceUrl)}
            <ExternalLink className="h-3 w-3" />
          </a>
          <span className="ml-2">· {CHECK_LABELS[fact.check]}</span>
        </summary>
        <blockquote className="mt-1 border-l-2 border-border pl-2 italic break-words">
          {fact.quote}
        </blockquote>
      </details>
    </div>
  </li>
);

const ListSection: React.FC<{ title: string; items: string[] }> = ({
  title,
  items,
}) =>
  items.length === 0 ? null : (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="space-y-1.5 leading-6">
        {items.map((item, index) => (
          <li key={`${index}-${item}`} className="flex gap-2">
            <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-foreground/45" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );

const ResearchBody: React.FC<{ research: CompanyResearch }> = ({
  research,
}) => {
  const brief = research.brief;
  if (!brief) return null;
  const issues = research.judgement?.issues ?? [];
  const topics = Array.from(new Set(brief.facts.map((fact) => fact.topic)));

  return (
    <div className="mt-4 space-y-5 text-sm">
      {brief.summary && (
        <p className="rounded-lg bg-muted/50 p-3 leading-6">{brief.summary}</p>
      )}

      {issues.length > 0 && (
        <div
          className={cn(
            "rounded-md border p-3",
            research.verdict === "passed"
              ? "border-border/60 bg-muted/30"
              : "border-amber-500/30 bg-amber-500/5",
          )}
        >
          <ListSection
            title={
              research.verdict === "passed"
                ? "Notes from the review"
                : "Check before using"
            }
            items={issues}
          />
        </div>
      )}

      <div className="grid gap-x-6 gap-y-5 lg:grid-cols-2">
        {topics.map((topic) => (
          <div key={topic} className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {TOPIC_LABELS[topic] ?? topic}
            </h3>
            <ul className="space-y-2">
              {brief.facts
                .filter((fact) => fact.topic === topic)
                .map((fact, index) => (
                  <FactItem key={`${index}-${fact.sourceUrl}`} fact={fact} />
                ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="grid gap-x-6 gap-y-5 lg:grid-cols-2">
        <ListSection title="Talking points" items={brief.talkingPoints} />
        <ListSection title="Questions to ask" items={brief.questionsToAsk} />
      </div>
    </div>
  );
};
