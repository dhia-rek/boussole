import type {
  AgentRun,
  AgentRunEvent,
  ApplicationPack,
} from "@shared/types.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Circle,
  Copy,
  Loader2,
  ShieldCheck,
  Sparkles,
  Square,
  TriangleAlert,
  Users,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import * as api from "@/client/api";
import { showErrorToast } from "@/client/lib/error-toast";
import { queryKeys } from "@/client/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The team, in the order the work flows. */
export const AGENT_TEAM = [
  {
    id: "orchestrator",
    name: "Team lead",
    role: "Plans the work, fixes what the critic finds, saves the result.",
  },
  {
    id: "job-analyst",
    name: "Job analyst",
    role: "Reads the posting: must-haves, keywords, contract, red flags.",
  },
  {
    id: "cv-tailor",
    name: "CV tailor",
    role: "Suggests your headline and what to put forward, from your CV only.",
  },
  {
    id: "cover-letter-writer",
    name: "Letter writer",
    role: "Writes the cover letter in the posting's language, from your CV only.",
  },
  {
    id: "critic",
    name: "Critic",
    role: "Checks every claim against your CV and your CV rules.",
  },
] as const;

type MemberState = "waiting" | "working" | "done";

/** What the agents' tools do, in plain words. */
const TOOL_WORDS: Record<string, string> = {
  get_job: "Reading the job posting",
  get_cv_profile: "Reading your CV",
  get_tailoring_rules: "Reading your CV rules",
  get_learned_preferences: "Reading what Boussole learned about you",
  save_application_pack: "Saving the result",
  task: "Handing work to the team",
};

/** Event text with the team's internal names in plain words. */
export function plainWords(text: string): string {
  const tool = TOOL_WORDS[text.trim()];
  if (tool) return tool;
  let result = text;
  for (const member of AGENT_TEAM) {
    result = result.split(member.id).join(member.name);
  }
  return result;
}

const ACTIVE = new Set<AgentRun["status"]>(["queued", "running"]);

/** Where each team member is, from the run's events. */
export function teamProgress(
  run: AgentRun,
): Record<string, { state: MemberState; now: string | null }> {
  const progress: Record<string, { state: MemberState; now: string | null }> =
    Object.fromEntries(
      AGENT_TEAM.map((member) => [member.id, { state: "waiting", now: null }]),
    );
  const touch = (event: AgentRunEvent, state?: MemberState) => {
    const member = progress[event.agent];
    if (!member) return;
    if (state) member.state = state;
    else if (member.state === "waiting") member.state = "working";
    const now = event.detail ?? event.label;
    if (now) member.now = plainWords(now);
  };
  for (const event of run.events) {
    if (event.type === "subagent_started") touch(event, "working");
    else if (event.type === "subagent_finished") touch(event, "done");
    else touch(event);
  }
  const lead = progress.orchestrator;
  if (lead) {
    lead.state =
      run.status === "succeeded"
        ? "done"
        : ACTIVE.has(run.status)
          ? "working"
          : lead.state;
  }
  if (run.status === "succeeded") {
    for (const member of Object.values(progress)) member.state = "done";
  }
  return progress;
}

function elapsedText(from: string | null, to: string | null): string {
  if (!from) return "";
  const end = to ? Date.parse(to) : Date.now();
  const seconds = Math.max(0, Math.round((end - Date.parse(from)) / 1000));
  return seconds < 60
    ? `${seconds} s`
    : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

const MemberIcon: React.FC<{ state: MemberState }> = ({ state }) =>
  state === "done" ? (
    <CheckCircle2
      className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
      aria-label="done"
    />
  ) : state === "working" ? (
    <Loader2
      className="h-4 w-4 shrink-0 animate-spin text-primary"
      aria-label="working"
    />
  ) : (
    <Circle
      className="h-4 w-4 shrink-0 text-muted-foreground/50"
      aria-label="waiting"
    />
  );

const Section: React.FC<{
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <section className="space-y-2 rounded-xl border border-border/50 bg-card/60 p-4">
    <h4 className="flex items-center gap-2 text-sm font-semibold">
      {icon}
      {title}
    </h4>
    {children}
  </section>
);

const PackView: React.FC<{ pack: ApplicationPack }> = ({ pack }) => (
  <div className="space-y-3">
    <Section title="Cover letter">
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">
        {pack.coverLetter}
      </pre>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(pack.coverLetter)
            .then(() => toast.success("Letter copied"));
        }}
      >
        <Copy className="mr-1.5 h-3.5 w-3.5" />
        Copy the letter
      </Button>
    </Section>
    <Section title="Suggested CV headline">
      <p className="text-sm">{pack.headline}</p>
    </Section>
    {pack.emphasis.length > 0 ? (
      <Section title="What to put forward in your CV">
        <ul className="space-y-1.5 text-sm">
          {pack.emphasis.map((item) => (
            <li key={item.section}>
              <span className="font-medium">{item.section}: </span>
              <span className="text-muted-foreground">{item.guidance}</span>
            </li>
          ))}
        </ul>
      </Section>
    ) : null}
    <Section
      title="The critic's review"
      icon={<ShieldCheck className="h-4 w-4 text-primary" />}
    >
      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
        {pack.critique}
      </p>
      {pack.unsupportedClaimsFixed.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {pack.unsupportedClaimsFixed.map((claim) => (
            <li key={claim}>{claim}</li>
          ))}
        </ul>
      ) : null}
    </Section>
    {pack.remainingRisks.length > 0 ? (
      <Section
        title="Watch out"
        icon={<TriangleAlert className="h-4 w-4 text-amber-500" />}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {pack.remainingRisks.map((risk) => (
            <li key={risk}>{risk}</li>
          ))}
        </ul>
      </Section>
    ) : null}
    <Section title="The job, as the analyst reads it">
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-muted-foreground">
        {pack.analysis}
      </pre>
    </Section>
  </div>
);

/**
 * "Prepare with the agent team": runs the four agents for one job, shows
 * each one working live, then the pack (letter, headline, emphasis, the
 * critic's review, risks).
 */
export const AgentTeamPanel: React.FC<{ jobId: string }> = ({ jobId }) => {
  const queryClient = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // The job's latest run, to show a past result or resume watching.
  const latestQuery = useQuery({
    queryKey: queryKeys.agents.latestForJob(jobId),
    queryFn: async () =>
      (await api.listAgentRuns({ jobId, limit: 1 })).find(
        (run) => run.kind === "application",
      ) ?? null,
  });
  const activeRunId = runId ?? latestQuery.data?.id ?? null;
  const runQuery = useQuery({
    queryKey: queryKeys.agents.run(activeRunId ?? "none"),
    queryFn: () => api.getAgentRun(activeRunId as string),
    enabled: Boolean(activeRunId),
    refetchInterval: (query) =>
      query.state.data && ACTIVE.has(query.state.data.status) ? 1_500 : false,
  });
  const run = runQuery.data ?? latestQuery.data ?? null;
  const running = run ? ACTIVE.has(run.status) : false;

  // Elapsed time moves every second while the team works.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () => setTick((value) => value + 1),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [running]);

  const start = useMutation({
    mutationFn: () => api.startApplicationAgents(jobId),
    onSuccess: (started) => {
      setRunId(started.id);
      queryClient.setQueryData(queryKeys.agents.run(started.id), started);
    },
    onError: (error) =>
      showErrorToast(error, "The agent team could not start."),
  });
  const stop = useMutation({
    mutationFn: (id: string) => api.cancelAgentRun(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
    onError: (error) => showErrorToast(error, "Could not stop the team."),
  });

  const progress = run ? teamProgress(run) : null;
  const pack =
    run?.status === "succeeded" && run.output?.kind === "application"
      ? run.output.pack
      : null;

  return (
    <section
      aria-labelledby="agent-team-title"
      className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3
            id="agent-team-title"
            className="flex items-center gap-2 font-semibold"
          >
            <Users className="h-4 w-4 text-primary" />
            Prepare with the agent team
          </h3>
          <p className="max-w-prose text-sm text-muted-foreground">
            Four AI agents work on this job together: an analyst reads the
            posting, a CV tailor and a letter writer work in parallel, and a
            critic checks every claim against your CV before anything is saved.
            About 2 to 3 minutes, on your AI account.
          </p>
        </div>
        {running && run ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => stop.mutate(run.id)}
            disabled={stop.isPending}
          >
            <Square className="mr-1.5 h-3.5 w-3.5" />
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => start.mutate()}
            disabled={start.isPending || latestQuery.isLoading}
          >
            {start.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            {pack ? "Run the team again" : "Prepare with the agent team"}
          </Button>
        )}
      </div>

      {run && progress ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {running
              ? `Working… ${elapsedText(run.startedAt ?? run.createdAt, null)}`
              : run.status === "succeeded"
                ? `Done in ${elapsedText(run.startedAt, run.finishedAt)} · ${run.stats.modelCalls} AI calls`
                : run.status === "cancelled"
                  ? "Stopped."
                  : "The team couldn't finish."}{" "}
            <Link
              to="/ai-activity"
              className="text-primary underline-offset-2 hover:underline"
            >
              Every step is in AI activity
            </Link>
          </p>
          <ol className="grid gap-1.5 sm:grid-cols-2">
            {AGENT_TEAM.map((member) => {
              const status = progress[member.id];
              return (
                <li
                  key={member.id}
                  className={cn(
                    "flex gap-2 rounded-lg border border-border/40 bg-card/60 p-2.5",
                    status?.state === "working" && "border-primary/40",
                  )}
                >
                  <MemberIcon state={status?.state ?? "waiting"} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{member.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {status?.state === "working" && status.now
                        ? status.now
                        : member.role}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          {run.status === "failed" && run.error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
            >
              {run.error}
            </p>
          ) : null}
        </div>
      ) : null}

      {pack ? <PackView pack={pack} /> : null}
    </section>
  );
};
