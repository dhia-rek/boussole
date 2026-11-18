/** Guided mode: the one next thing to do, then a few after it. */
export type GuideStepKind =
  | "add_cv"
  | "prepare_interview"
  | "follow_up"
  | "continue_application"
  | "search_running"
  | "find_jobs"
  | "recalculate_scores"
  | "choose_job"
  | "caught_up";

export interface GuideStepAction {
  label: string;
  /** Page to open. */
  href?: string;
  /** Or an action the page runs itself. */
  action?: "recalculate" | "log_follow_up";
  jobIds?: string[];
}

export interface GuideStep {
  kind: GuideStepKind;
  title: string;
  detail: string;
  cta: GuideStepAction;
  /** A second, quieter choice (for example "I've sent it"). */
  secondary?: GuideStepAction;
  jobId?: string;
}

/** Stage-event reason code that records "I sent a follow-up". */
export const FOLLOW_UP_REASON_CODE = "follow_up_sent";

export interface GuideNextSteps {
  /** Most useful first; the first one is "your next step". */
  steps: GuideStep[];
}

/** One job in the "choose your next application" review, best first. */
export interface GuideReviewItem {
  id: string;
  title: string;
  employer: string;
  location: string | null;
  score: number;
  reason: string | null;
  roleSummary: string | null;
  status: "discovered" | "ready";
  discoveredAt: string;
}

/** The five steps of a guided application. */
export const GUIDED_APPLY_STEPS = [
  "job",
  "cv",
  "company",
  "message",
  "send",
] as const;
export type GuidedApplyStep = (typeof GUIDED_APPLY_STEPS)[number];

export const GUIDED_APPLY_STEP_LABELS: Record<GuidedApplyStep, string> = {
  job: "The job",
  cv: "Your CV",
  company: "The company",
  message: "Your message",
  send: "Send it",
};

/** How far one guided application got. */
export interface GuideApplyProgress {
  jobId: string;
  done: { cv: boolean; company: boolean; message: boolean };
  applied: boolean;
  /** First step still to do ("cv" when nothing was started). */
  nextStep: GuidedApplyStep;
}
