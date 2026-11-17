/**
 * Application agent: a LangChain Deep Agent (orchestrator + four subagents
 * chained through the `task` tool) that prepares an application pack for one
 * job — analysis, CV headline and emphasis, cover letter, and a critique of
 * every claim against the CV.
 *
 * All data comes from tenant-scoped reads made before the agent starts; the
 * tools only hand out that data (the agents cannot reach other jobs or
 * tenants). CV data goes through the AI profile view (no contact details,
 * private sections removed).
 */
import { randomUUID } from "node:crypto";
import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  buildAiProfileView,
  formatCandidateNotes,
  formatTailoringRulesForPrompt,
  resolveTailoringRules,
} from "@server/services/ai-profile-context";
import {
  enforceTailoringRules,
  getOriginalTailoringValues,
} from "@server/services/summary";
import type { ApplicationPack, Job, ResumeProfile } from "@shared/types";
import {
  CompositeBackend,
  createDeepAgent,
  StateBackend,
  type SubAgent,
} from "deepagents";
import { tool } from "langchain";
import { z } from "zod";
import { createMemoryBackend } from "./memory-store";

const MAX_JOB_DESCRIPTION_CHARS = 12_000;
const MAX_COMPANY_DESCRIPTION_CHARS = 2_000;
export const APPLICATION_AGENT_RECURSION_LIMIT = 60;

export interface ApplicationAgentInput {
  job: Job;
  /** Profile of the CV variant used for this job (raw; never sent as-is). */
  profile: ResumeProfile;
  /** Learned preferences (`/memories/preferences.md`), if any. */
  preferences: string | null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…[truncated]` : value;
}

/** The job as the agents see it: posting fields only, bounded. */
export function buildJobBrief(job: Job): string {
  return JSON.stringify(
    {
      title: job.title,
      employer: job.employer,
      location: job.location,
      remote: job.isRemote,
      contract: job.jobType,
      level: job.jobLevel,
      salary: job.salary,
      posted: job.datePosted,
      description: truncate(
        job.jobDescription ?? "",
        MAX_JOB_DESCRIPTION_CHARS,
      ),
      companyDescription: job.companyDescription
        ? truncate(job.companyDescription, MAX_COMPANY_DESCRIPTION_CHARS)
        : null,
    },
    null,
    2,
  );
}

export function buildTailoringRulesText(profile: ResumeProfile): string {
  const rules = resolveTailoringRules(profile);
  const originals = getOriginalTailoringValues(profile);
  const notes = formatCandidateNotes(profile);
  return [
    "Tailoring rules (Forsa enforces them again after you answer):",
    formatTailoringRulesForPrompt(rules) || "- No special rules.",
    `Current headline: "${originals.headline}"`,
    rules.summary.mode === "keep"
      ? `Current summary (locked, keep word for word): "${originals.summary}"`
      : "",
    notes ? `Candidate notes:\n${notes}` : "",
    "Sections missing from the CV view are private: never mention them.",
  ]
    .filter(Boolean)
    .join("\n");
}

const packSchema = z.object({
  analysis: z.string().min(1).max(4000),
  headline: z.string().min(1).max(200),
  emphasis: z
    .array(
      z.object({
        section: z.string().min(1).max(60),
        guidance: z.string().min(1).max(600),
      }),
    )
    .max(12),
  coverLetter: z.string().min(1).max(6000),
  coverLetterLanguage: z.string().min(2).max(10),
  critique: z.string().max(3000),
  unsupportedClaimsFixed: z.array(z.string().max(400)).max(20),
  remainingRisks: z.array(z.string().max(400)).max(10),
});

export type ApplicationPackSink = { pack: ApplicationPack | null };

export function buildApplicationTools(
  input: ApplicationAgentInput,
  sink: ApplicationPackSink,
) {
  const jobBrief = buildJobBrief(input.job);
  const cvView = JSON.stringify(buildAiProfileView(input.profile));
  const rulesText = buildTailoringRulesText(input.profile);
  const preferences =
    input.preferences?.trim() || "No learned preferences yet.";

  const getJob = tool(async () => jobBrief, {
    name: "get_job",
    description:
      "The job posting this application is for: title, employer, location, contract, level, salary and description.",
    schema: z.object({}),
  });
  const getCvProfile = tool(async () => cvView, {
    name: "get_cv_profile",
    description:
      "The candidate's CV for this job as the AI may see it (contact details and private sections removed; candidate notes attached as aiNotes).",
    schema: z.object({}),
  });
  const getTailoringRules = tool(async () => rulesText, {
    name: "get_tailoring_rules",
    description:
      "The candidate's tailoring rules: locked sections, headline prefix and notes. Follow them exactly.",
    schema: z.object({}),
  });
  const getLearnedPreferences = tool(async () => preferences, {
    name: "get_learned_preferences",
    description:
      "What Forsa learned from the candidate's past apply/skip decisions (may be empty).",
    schema: z.object({}),
  });
  const saveApplicationPack = tool(
    async (pack) => {
      sink.pack = pack;
      return "Application pack saved.";
    },
    {
      name: "save_application_pack",
      description:
        "Save the final application pack. Call it once, after fixing everything the critic reported.",
      schema: packSchema,
    },
  );

  return {
    getJob,
    getCvProfile,
    getTailoringRules,
    getLearnedPreferences,
    saveApplicationPack,
  };
}

const ORCHESTRATOR_PROMPT = `You coordinate Forsa's application agents for ONE job posting. Keep every step short.
1. Call \`task\` with subagent_type "job-analyst" (description: "Analyse the job posting.").
2. In ONE reply, call \`task\` twice: "cv-tailor" and "cover-letter-writer". Paste the analyst's findings into both descriptions.
3. Call \`task\` with "critic". Paste the proposed headline, emphasis and full cover letter into the description.
4. Fix every unsupported claim and rule violation the critic reports yourself: remove or reword it, never add new facts. Do not run any subagent a second time.
5. Call \`save_application_pack\` once with the final pack, then finish with a two-sentence summary.
Rules: only use the four subagents above (never "general-purpose"); never invent experience, employers, dates, numbers or skills; never include contact details; the cover letter is written in the job posting's language.`;

const JOB_ANALYST_PROMPT = `You are the job-analyst. Call get_job, then reply in English with a compact analysis (at most 200 words):
- Must-have requirements
- Nice-to-have requirements
- Keywords to mirror (exact wording from the posting)
- Seniority and contract type (CDI, CDD, internship, freelance…)
- Red flags or open questions
Use only the posting.`;

const CV_TAILOR_PROMPT = `You are the cv-tailor. In one reply call get_job, get_cv_profile and get_tailoring_rules. Then answer:
HEADLINE: <one line>
EMPHASIS:
- <CV section>: <what to put forward for this job, citing items that already exist in the CV>
Follow get_tailoring_rules exactly (locked sections stay word for word, respect the headline prefix). Only reorder or reword facts already in the CV; never invent experience, tools, numbers or dates; never use sections that are missing from the CV view.`;

const COVER_LETTER_PROMPT = `You are the cover-letter-writer. In one reply call get_job, get_cv_profile and get_learned_preferences. Then write the cover letter:
- in the job posting's language (French posting → French letter);
- 180 to 250 words, 3 or 4 short paragraphs, no placeholders such as [Company];
- every claim comes from the CV or the candidate notes; connect 2 or 3 concrete CV items to the job's must-haves;
- no contact details, address block or date line.
Reply with the letter only, then a last line "LANGUAGE: <fr|en|…>".`;

const CRITIC_PROMPT = `You are the critic. In one reply call get_cv_profile and get_tailoring_rules. Then check the headline, emphasis and cover letter you were given, claim by claim:
UNSUPPORTED: each claim not backed by the CV or candidate notes (quote it), or "none"
RULES: each tailoring-rule violation (locked section changed, missing headline prefix…), or "none"
VERDICT: ok | fix-needed
Be strict and short.`;

export function createApplicationAgent(args: {
  model: BaseChatModel;
  tools: ReturnType<typeof buildApplicationTools>;
}) {
  const { tools } = args;
  const subagents: SubAgent[] = [
    {
      name: "job-analyst",
      description:
        "Analyses the job posting: requirements, keywords to mirror, seniority, contract type and red flags.",
      systemPrompt: JOB_ANALYST_PROMPT,
      tools: [tools.getJob],
    },
    {
      name: "cv-tailor",
      description:
        "Proposes the CV headline and what to emphasise in each CV section for this job, following the candidate's tailoring rules. Never invents experience.",
      systemPrompt: CV_TAILOR_PROMPT,
      tools: [
        tools.getJob,
        tools.getCvProfile,
        tools.getTailoringRules,
        tools.getLearnedPreferences,
      ],
    },
    {
      name: "cover-letter-writer",
      description:
        "Writes a concise cover letter in the job posting's language, grounded only in CV facts and candidate notes.",
      systemPrompt: COVER_LETTER_PROMPT,
      tools: [tools.getJob, tools.getCvProfile, tools.getLearnedPreferences],
    },
    {
      name: "critic",
      description:
        "Checks a proposed headline, emphasis and cover letter claim by claim against the CV and the tailoring rules.",
      systemPrompt: CRITIC_PROMPT,
      tools: [tools.getCvProfile, tools.getTailoringRules],
    },
  ];

  return createDeepAgent({
    name: "orchestrator",
    model: args.model,
    systemPrompt: ORCHESTRATOR_PROMPT,
    tools: [tools.getJob, tools.saveApplicationPack],
    subagents,
    // Scratch files live in the run's state; `/memories/` is the tenant's
    // persistent store, read-only for this agent (the learner writes it).
    backend: new CompositeBackend(new StateBackend(), {
      "/memories/": createMemoryBackend(),
    }),
    permissions: [
      { operations: ["write"], paths: ["/memories/**"], mode: "deny" },
    ],
  });
}

/** Applies the candidate's headline rules and tidies the saved pack. */
export function finalizeApplicationPack(
  pack: ApplicationPack,
  input: ApplicationAgentInput,
): ApplicationPack {
  const rules = resolveTailoringRules(input.profile);
  const originals = getOriginalTailoringValues(input.profile);
  const { headline } = enforceTailoringRules(
    { headline: pack.headline.trim(), summary: originals.summary, skills: [] },
    rules,
    originals,
    input.job.title,
  );
  return {
    ...pack,
    headline,
    analysis: pack.analysis.trim(),
    coverLetter: pack.coverLetter.trim(),
    coverLetterLanguage: pack.coverLetterLanguage.trim().toLowerCase(),
    critique: pack.critique.trim(),
  };
}

export async function runApplicationAgent(args: {
  input: ApplicationAgentInput;
  model: BaseChatModel;
  signal: AbortSignal;
  callbacks?: BaseCallbackHandler[];
}): Promise<ApplicationPack> {
  const sink: ApplicationPackSink = { pack: null };
  const tools = buildApplicationTools(args.input, sink);
  const agent = createApplicationAgent({ model: args.model, tools });
  await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content: "Prepare the application pack for this job.",
        },
      ],
    },
    {
      recursionLimit: APPLICATION_AGENT_RECURSION_LIMIT,
      signal: args.signal,
      callbacks: args.callbacks,
      configurable: { thread_id: randomUUID() },
    },
  );
  if (!sink.pack) {
    throw new Error("The agents finished without saving an application pack.");
  }
  return finalizeApplicationPack(sink.pack, args.input);
}
