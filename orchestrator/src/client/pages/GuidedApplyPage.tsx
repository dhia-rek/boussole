import { detectApplyRoutes } from "@shared/apply-route";
import {
  GUIDED_APPLY_STEP_LABELS,
  GUIDED_APPLY_STEPS,
  type GuideApplyProgress,
  type GuidedApplyStep,
  type Job,
} from "@shared/types.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  FileDown,
  ListChecks,
  Loader2,
  PenLine,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { toast } from "sonner";
import * as api from "@/client/api";
import { invalidateJobData } from "@/client/hooks/queries/invalidate";
import { useQueryErrorToast } from "@/client/hooks/useQueryErrorToast";
import { showErrorToast } from "@/client/lib/error-toast";
import { openJobPdf } from "@/client/lib/private-pdf";
import { queryKeys } from "@/client/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AgentTeamPanel } from "../components/agents/AgentTeamPanel";
import { GhostwriterPanel } from "../components/ghostwriter/GhostwriterPanel";
import { JobBriefPane, parseJobBrief } from "../components/JobBriefPane";
import { JobDescriptionMarkdown } from "../components/JobDescriptionMarkdown";
import { PageHeader, PageMain } from "../components/layout";
import { CompanyResearchCard } from "./job-page/CompanyResearchCard";
import { CvCheckCard } from "./job-page/CvCheckCard";
import { HowToApplyCard } from "./job-page/HowToApplyCard";

export const EMAIL_PROMPT =
  "Write my application email for this job, in the language of the job posting: a clear subject line, then a short body (under 150 words) that names the role, gives two concrete reasons from my CV that match what they ask for, uses one specific fact about the company if the research has one, and says my CV is attached.";
export const COVER_LETTER_PROMPT =
  "Write a short cover letter for this job, in the language of the job posting (under 250 words): why this role and this company (use one specific fact from the company research if there is one), two or three concrete matches between my CV and what they ask for, and a short closing. No generic filler.";

const FOLLOW_UP_DAYS = 7;

type MessageMode = "ghostwriter" | "agents";

function isGuidedStep(value: string | null): value is GuidedApplyStep {
  return (GUIDED_APPLY_STEPS as readonly string[]).includes(value ?? "");
}

/** Where to land without ?step=: start, resume, or the "applied" screen. */
export function defaultStep(
  progress: GuideApplyProgress | undefined,
): GuidedApplyStep {
  if (!progress) return "job";
  if (progress.applied) return "send";
  const { cv, company, message } = progress.done;
  if (!cv && !company && !message) return "job";
  return progress.nextStep;
}

function isStepDone(
  step: GuidedApplyStep,
  progress: GuideApplyProgress | undefined,
  current: GuidedApplyStep,
): boolean {
  if (!progress) return false;
  if (step === "job") {
    return (
      GUIDED_APPLY_STEPS.indexOf(current) > 0 ||
      progress.applied ||
      Object.values(progress.done).some(Boolean)
    );
  }
  if (step === "cv") return progress.done.cv;
  if (step === "company") return progress.done.company;
  if (step === "message") return progress.done.message;
  return progress.applied;
}

const Stepper: React.FC<{
  current: GuidedApplyStep;
  progress: GuideApplyProgress | undefined;
  onSelect: (step: GuidedApplyStep) => void;
}> = ({ current, progress, onSelect }) => (
  <nav aria-label="Application steps">
    <ol className="grid grid-cols-5 gap-1.5">
      {GUIDED_APPLY_STEPS.map((step, index) => {
        const isCurrent = step === current;
        const done = isStepDone(step, progress, current);
        return (
          <li key={step}>
            <button
              type="button"
              onClick={() => onSelect(step)}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "flex w-full flex-col items-center gap-1.5 rounded-lg px-1 py-2 text-center transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isCurrent && "bg-muted/50",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                  isCurrent
                    ? "border-primary bg-primary text-primary-foreground"
                    : done
                      ? "border-emerald-500/60 text-emerald-600 dark:text-emerald-400"
                      : "border-border text-muted-foreground",
                )}
              >
                {done && !isCurrent ? (
                  <Check className="h-3.5 w-3.5" aria-label="done" />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn(
                  "text-[11px] leading-tight sm:text-xs",
                  isCurrent
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {GUIDED_APPLY_STEP_LABELS[step]}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  </nav>
);

const StepIntro: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div className="space-y-1">
    <h2 className="font-display text-xl font-bold leading-tight">{title}</h2>
    <p className="max-w-prose text-sm leading-6 text-muted-foreground">
      {children}
    </p>
  </div>
);

const JobStep: React.FC<{
  job: Job;
  onSkip: () => void;
  skipping: boolean;
}> = ({ job, onSkip, skipping }) => (
  <div className="space-y-4">
    <StepIntro title="Is this job for you?">
      Read the summary. If it's not for you, skip it: Boussole won't suggest it
      again.
    </StepIntro>
    <JobBriefPane job={job} showFit />
    {!parseJobBrief(job.jobBrief) && job.jobDescription?.trim() ? (
      <section
        aria-label="Job description"
        className="max-h-[28rem] overflow-y-auto rounded-xl border border-border/50 bg-card/40 p-4 text-sm"
      >
        <JobDescriptionMarkdown description={job.jobDescription} />
      </section>
    ) : null}
    <div className="flex flex-wrap items-center gap-2">
      {job.jobUrl ? (
        <Button variant="ghost" size="sm" asChild>
          <a href={job.jobUrl} target="_blank" rel="noopener noreferrer">
            Read the original posting
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </a>
        </Button>
      ) : null}
      <Button variant="outline" size="sm" onClick={onSkip} disabled={skipping}>
        Not for me
      </Button>
    </div>
  </div>
);

const CvPdfBlock: React.FC<{ job: Job }> = ({ job }) => {
  const queryClient = useQueryClient();
  const tailor = useMutation({
    mutationFn: () =>
      job.status === "discovered"
        ? api.processJob(job.id)
        : api.generateJobPdf(job.id),
    onSuccess: async () => {
      toast.success("Your CV for this job is ready");
      await invalidateJobData(queryClient, job.id);
    },
    onError: (error) => showErrorToast(error, "Could not prepare your CV."),
  });
  const notTailored = job.status === "discovered" || !job.pdfPath;

  return (
    <section
      aria-labelledby="cv-pdf-title"
      className="rounded-xl border border-border/50 bg-card/75 p-4"
    >
      <h3 id="cv-pdf-title" className="text-sm font-semibold">
        The CV you will send
      </h3>
      {notTailored ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Boussole hasn't made a version of your CV for this job yet. It
            adapts the headline, summary and skills order to the job; your saved
            CV stays as it is.
          </p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => tailor.mutate()}
            disabled={tailor.isPending}
          >
            {tailor.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : null}
            {tailor.isPending
              ? "Preparing… (about a minute)"
              : "Prepare my CV for this job"}
          </Button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            {job.pdfRegenerating
              ? "Your CV PDF is being updated…"
              : job.pdfFreshness === "stale"
                ? "Your CV changed since this PDF was made. Update it before sending."
                : "Your CV for this job is ready to send."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void openJobPdf(job.id).catch((error) =>
                  showErrorToast(error, "Could not open the CV PDF"),
                );
              }}
            >
              <FileDown className="mr-1.5 h-3.5 w-3.5" />
              Open my CV (PDF)
            </Button>
            {job.pdfFreshness === "stale" && !job.pdfRegenerating ? (
              <Button
                size="sm"
                onClick={() => tailor.mutate()}
                disabled={tailor.isPending}
              >
                {tailor.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Update the PDF
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" asChild>
              <Link to={`/jobs/ready/${job.id}`}>Fine-tune it</Link>
            </Button>
          </div>
        </>
      )}
    </section>
  );
};

const MessageStep: React.FC<{ job: Job; initialMode: MessageMode }> = ({
  job,
  initialMode,
}) => {
  const route = detectApplyRoutes(job).primary;
  const byEmail = route?.channel === "email";
  const [prompt, setPrompt] = useState<string | null>(null);
  const [mode, setMode] = useState<MessageMode>(initialMode);
  return (
    <div className="space-y-4">
      <fieldset className="inline-flex rounded-lg border border-border/60 p-0.5 text-sm">
        <legend className="sr-only">Who writes it</legend>
        {(
          [
            ["ghostwriter", "Ghostwriter (chat)"],
            ["agents", "Agent team (full pack)"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              "rounded-md px-3 py-1.5",
              mode === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </fieldset>
      {mode === "agents" ? (
        <AgentTeamPanel jobId={job.id} />
      ) : (
        <>
          <StepIntro
            title={
              byEmail
                ? "Write your application email"
                : "Write a short cover letter"
            }
          >
            {byEmail
              ? `This job is applied to by email${route?.email ? ` (${route.email})` : ""}. Ghostwriter writes it from your CV, the job and the company research. Ask for any change in the chat below.`
              : "Most application forms have a cover letter or message field. Ghostwriter writes one from your CV, the job and the company research. Ask for any change in the chat below."}
          </StepIntro>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                setPrompt(byEmail ? EMAIL_PROMPT : COVER_LETTER_PROMPT)
              }
              disabled={prompt !== null}
            >
              <PenLine className="mr-1.5 h-3.5 w-3.5" />
              {byEmail ? "Write my email" : "Write my cover letter"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setPrompt(byEmail ? COVER_LETTER_PROMPT : EMAIL_PROMPT)
              }
              disabled={prompt !== null}
            >
              {byEmail ? "A cover letter instead" : "An email instead"}
            </Button>
          </div>
          <div className="h-[65vh] min-h-[420px] rounded-xl border border-border/50 bg-card/40 px-3 pt-3">
            <GhostwriterPanel
              job={job}
              initialPrompt={prompt}
              onInitialPromptConsumed={() => setPrompt(null)}
            />
          </div>
        </>
      )}
    </div>
  );
};

const AppliedPanel: React.FC<{ job: Job }> = ({ job }) => {
  const appliedAt = job.appliedAt ? new Date(job.appliedAt) : new Date();
  const followUp = new Date(appliedAt.getTime() + FOLLOW_UP_DAYS * 86_400_000);
  const followUpLabel = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(followUp);
  return (
    <section className="space-y-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-6">
      <h2 className="flex items-center gap-2 font-display text-xl font-bold">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        You applied to {job.employer}
      </h2>
      <p className="text-sm text-muted-foreground">
        If you haven't heard back by {followUpLabel}, Today will remind you to
        follow up and help you write it. Replies and interviews go on the{" "}
        <Link
          to="/applications/in-progress"
          className="text-primary underline-offset-2 hover:underline"
        >
          Applications board
        </Link>
        .
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button asChild>
          <Link to="/today">
            Back to Today <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/review">Choose another job</Link>
        </Button>
      </div>
    </section>
  );
};

/** One application in five short steps, one screen each. */
export const GuidedApplyPage: React.FC = () => {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const jobQuery = useQuery({
    queryKey: queryKeys.jobs.detail(id),
    queryFn: () => api.getJob(id),
    enabled: Boolean(id),
  });
  const progressQuery = useQuery({
    queryKey: queryKeys.jobs.guideProgress(id),
    queryFn: () => api.getGuideApplyProgress(id),
    enabled: Boolean(id),
  });
  useQueryErrorToast(progressQuery.error, "Could not load your progress.");

  const stepParam = searchParams.get("step");
  const step: GuidedApplyStep = isGuidedStep(stepParam)
    ? stepParam
    : defaultStep(progressQuery.data);
  const index = GUIDED_APPLY_STEPS.indexOf(step);
  const job = jobQuery.data;

  // Done marks follow what happened inside each step.
  const refetchProgress = progressQuery.refetch;
  useEffect(() => {
    void step;
    void refetchProgress();
  }, [step, refetchProgress]);

  const goTo = (next: GuidedApplyStep) => {
    setSearchParams({ step: next });
    window.scrollTo({ top: 0 });
  };

  const skip = useMutation({
    mutationFn: () => api.skipJob(id),
    onSuccess: async (skipped) => {
      toast.success(
        `Skipped ${skipped.employer}. It won't be suggested again.`,
      );
      await invalidateJobData(queryClient, id);
      navigate("/today");
    },
    onError: (error) => showErrorToast(error, "Could not skip this job."),
  });

  if (jobQuery.isLoading) {
    return (
      <PageMain className="max-w-3xl">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </PageMain>
    );
  }
  if (!job) {
    return (
      <PageMain className="max-w-3xl space-y-3">
        <p className="text-sm text-muted-foreground">
          This job doesn't exist anymore.
        </p>
        <Button asChild variant="outline">
          <Link to="/today">Back to Today</Link>
        </Button>
      </PageMain>
    );
  }

  const applied = job.status === "applied" || job.status === "in_progress";
  const nextStep = GUIDED_APPLY_STEPS[index + 1];
  const previousStep = GUIDED_APPLY_STEPS[index - 1];

  return (
    <>
      <PageHeader
        icon={ListChecks}
        title={`Apply to ${job.employer}`}
        subtitle={job.title}
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/job/${job.id}`}>Full job page</Link>
          </Button>
        }
      />
      <PageMain className="max-w-3xl space-y-5">
        <Stepper current={step} progress={progressQuery.data} onSelect={goTo} />

        <section aria-label={GUIDED_APPLY_STEP_LABELS[step]}>
          {step === "job" ? (
            <JobStep
              job={job}
              onSkip={() => skip.mutate()}
              skipping={skip.isPending}
            />
          ) : null}
          {step === "cv" ? (
            <div className="space-y-4">
              <StepIntro title="Your CV for this job">
                See which lines of your CV fit this job, which to reword and
                which to cut. Your saved CV is never changed.
              </StepIntro>
              <CvCheckCard jobId={job.id} />
              <CvPdfBlock job={job} />
            </div>
          ) : null}
          {step === "company" ? (
            <div className="space-y-4">
              <StepIntro title="Get to know the company">
                A few verified facts make your message and your interview
                specific. Each fact links to the page it was found on.
              </StepIntro>
              <CompanyResearchCard jobId={job.id} />
            </div>
          ) : null}
          {step === "message" ? (
            <MessageStep
              job={job}
              initialMode={
                searchParams.get("with") === "agents" ? "agents" : "ghostwriter"
              }
            />
          ) : null}
          {step === "send" ? (
            applied ? (
              <AppliedPanel job={job} />
            ) : (
              <div className="space-y-4">
                <StepIntro title="Send your application">
                  Apply where the posting says, then confirm here so Boussole
                  tracks it and reminds you to follow up.
                </StepIntro>
                <HowToApplyCard job={job} baseJobPath={`/job/${job.id}`} />
              </div>
            )
          ) : null}
        </section>

        {step === "send" && applied ? null : (
          <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-4">
            {previousStep ? (
              <Button variant="ghost" onClick={() => goTo(previousStep)}>
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Back
              </Button>
            ) : (
              <span />
            )}
            {nextStep ? (
              <Button onClick={() => goTo(nextStep)}>
                Next: {GUIDED_APPLY_STEP_LABELS[nextStep].toLowerCase()}
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            ) : null}
          </div>
        )}
      </PageMain>
    </>
  );
};
