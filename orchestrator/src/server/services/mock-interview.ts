import { badRequest, requestTimeout, upstreamError } from "@infra/errors";
import { logger } from "@infra/logger";
import type {
  MockInterviewNextTurn,
  MockInterviewReport,
  MockInterviewRound,
  MockInterviewTurn,
} from "@shared/types";
import { MOCK_INTERVIEW_ROUND_LABELS } from "@shared/types";
import { buildJobChatPromptContext } from "./ghostwriter-context";
import { LlmService } from "./llm/service";
import type { JsonSchemaDefinition, LlmMessage } from "./llm/types";
import { resolveLlmModel } from "./modelSelection";

const TURN_SCHEMA: JsonSchemaDefinition = {
  name: "mock_interview_turn",
  schema: {
    type: "object",
    properties: {
      message: { type: "string" },
      ended: { type: "boolean" },
    },
    required: ["message", "ended"],
    additionalProperties: false,
  },
};

const REPORT_SCHEMA: JsonSchemaDefinition = {
  name: "mock_interview_report",
  schema: {
    type: "object",
    properties: {
      overallScore: { type: "number" },
      recommendation: { type: "string" },
      summary: { type: "string" },
      strengths: { type: "array", items: { type: "string" } },
      improvements: { type: "array", items: { type: "string" } },
      competencies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            score: { type: "number" },
            comment: { type: "string" },
          },
          required: ["name", "score", "comment"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "overallScore",
      "recommendation",
      "summary",
      "strengths",
      "improvements",
      "competencies",
    ],
    additionalProperties: false,
  },
};

function roundGuidance(round: MockInterviewRound): string {
  switch (round) {
    case "hr":
      return "This is an HR / behavioral round. Focus on motivation, fit, teamwork, communication, strengths and weaknesses, handling conflict, and situational (STAR) questions. Do not ask deep technical questions.";
    case "technical":
      return "This is a technical round. Ask role-specific technical questions derived from the job's required skills and the candidate's background: concepts, trade-offs, problem discussion, and reasoning. Do not run or grade code; assess understanding through discussion.";
    default:
      return "This is a full interview loop. Begin with 3-4 HR / behavioral questions, then clearly transition ('Let's move on to the technical part') and ask 4-6 technical questions based on the job's required skills.";
  }
}

export type InterviewLanguage = "fr" | "en";

const ROLE_BY_ROUND: Record<MockInterviewRound, string> = {
  hr: "a recruiter at the hiring company",
  technical:
    "a senior member of the team the candidate would join (for example the data or engineering lead)",
  full: "the hiring manager for this role, who runs both the HR and the technical part",
};

/** A first name usable in the prompt (from the chosen voice), or null. */
export function cleanInterviewerName(
  value: string | null | undefined,
): string | null {
  const name = value?.trim() ?? "";
  return /^\p{Lu}[\p{L}'-]{1,24}$/u.test(name) ? name : null;
}

/**
 * The interviewer's single system prompt: who they are, how they sound
 * (their words are read aloud), and how they run the interview.
 */
export function interviewerSystemPrompt(input: {
  round: MockInterviewRound;
  language?: InterviewLanguage | null;
  interviewerName?: string | null;
}): string {
  const name = cleanInterviewerName(input.interviewerName);
  const language =
    input.language === "fr"
      ? "French"
      : input.language === "en"
        ? "English"
        : null;
  return [
    `You are ${name ?? "the interviewer"}, ${ROLE_BY_ROUND[input.round]}, running a realistic ${MOCK_INTERVIEW_ROUND_LABELS[input.round]} interview for the role described in the job context. The candidate prepares for a real interview with you.`,
    "",
    "Language:",
    language
      ? `- Speak only ${language}, the language of the job posting, even if the candidate switches language.`
      : "- Speak only the language of the job posting, even if the candidate switches language.",
    "",
    "Who you are:",
    `- ${name ? `Your first name is ${name}. Use it when you introduce yourself, and make every word that agrees with you (for example "ravi" or "ravie" in French) match that name.` : "You have no name: introduce yourself by your role only."}`,
    "- Warm but professional, curious and precise. You listen closely and dig into specifics.",
    "- Stay in character the whole time: no feedback, scores, hints or coaching during the interview, even if asked.",
    "",
    "How you sound: a voice reads your words aloud.",
    "- One question or follow-up per turn, in one to three short spoken sentences (under 60 words).",
    "- Plain speech only: no lists, markdown, emojis, parentheses, slashes or abbreviations a voice would misread.",
    "- Before your next question, acknowledge the answer in a few neutral words without judging it, and vary them.",
    "- In French, use vous and natural spoken French.",
    "",
    "How you run the interview:",
    "- Open with a short greeting, introduce yourself in one sentence, then ask your first question.",
    "- Make questions specific to this job and to what the candidate actually did, using the job context and the candidate profile.",
    "- When an answer is vague, follow up: ask for a concrete example, a number, their own part, or a trade-off they made.",
    `- ${roundGuidance(input.round)}`,
    '- After roughly 6 to 10 questions (more for a full loop), close: thank the candidate, say in one sentence what happens next, and set "ended" to true. The closing has no question and no evaluation.',
    "",
    'Respond ONLY as JSON: {"message": string, "ended": boolean}.',
  ].join("\n");
}

function transcriptToLlmMessages(
  transcript: readonly MockInterviewTurn[],
): LlmMessage[] {
  if (transcript.length === 0) {
    return [{ role: "user", content: "Please begin the interview." }];
  }
  return transcript.map((turn) => ({
    role: turn.role === "interviewer" ? "assistant" : "user",
    content: turn.content,
  }));
}

function clampScore(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export async function generateInterviewerTurn(input: {
  jobId: string;
  round: MockInterviewRound;
  transcript: readonly MockInterviewTurn[];
  language?: InterviewLanguage | null;
  interviewerName?: string | null;
  signal?: AbortSignal;
}): Promise<MockInterviewNextTurn> {
  const context = await buildJobChatPromptContext(input.jobId);
  const model = await resolveLlmModel();
  const llm = new LlmService();

  const messages: LlmMessage[] = [
    {
      role: "system",
      content: interviewerSystemPrompt({
        round: input.round,
        language: input.language,
        interviewerName: input.interviewerName,
      }),
    },
    { role: "system", content: `Job Context (JSON):\n${context.jobSnapshot}` },
    {
      role: "system",
      content: `Candidate Profile:\n${context.profileSnapshot || "No profile context available."}`,
    },
    ...transcriptToLlmMessages(input.transcript),
  ];

  const result = await llm.callJson<{ message: string; ended: boolean }>({
    model,
    messages,
    jsonSchema: TURN_SCHEMA,
    maxRetries: 1,
    retryDelayMs: 300,
    jobId: input.jobId,
    signal: input.signal,
  });

  if (!result.success) {
    if (input.signal?.aborted) {
      throw requestTimeout("Mock interview turn was cancelled");
    }
    throw upstreamError("Interviewer generation failed", {
      reason: result.error,
    });
  }

  const message = (result.data.message || "").trim();
  if (!message) {
    throw upstreamError("Interviewer returned an empty response");
  }

  const questionNumber =
    input.transcript.filter((turn) => turn.role === "interviewer").length + 1;

  logger.info("Mock interview turn generated", {
    jobId: input.jobId,
    round: input.round,
    questionNumber,
    ended: Boolean(result.data.ended),
    transcriptTurns: input.transcript.length,
  });

  return {
    message,
    ended: Boolean(result.data.ended),
    questionNumber,
  };
}

export async function generateReport(input: {
  jobId: string;
  round: MockInterviewRound;
  transcript: readonly MockInterviewTurn[];
}): Promise<MockInterviewReport> {
  if (input.transcript.length < 2) {
    throw badRequest("Not enough interview transcript to evaluate");
  }

  const context = await buildJobChatPromptContext(input.jobId);
  const model = await resolveLlmModel();
  const llm = new LlmService();

  const transcriptText = input.transcript
    .map(
      (turn) =>
        `${turn.role === "interviewer" ? "Interviewer" : "Candidate"}: ${turn.content}`,
    )
    .join("\n\n");

  const systemPrompt = [
    `You are an experienced interview evaluator assessing a candidate's ${MOCK_INTERVIEW_ROUND_LABELS[input.round]} interview for the role in the job context.`,
    "Evaluate ONLY the candidate's answers (the 'Candidate:' turns) against the job requirements and the candidate's profile.",
    "Be honest, specific, and constructive. Reference concrete moments from the transcript. Do not be sycophantic; flag weak or vague answers.",
    "Scores are 0-100. Pick 4-6 competencies relevant to this round and role (e.g. communication, role knowledge, problem solving, culture fit, depth).",
    "recommendation: one of 'Strong hire', 'Lean hire', 'Borderline', or 'No hire' followed by a one-line rationale.",
  ].join("\n");

  const result = await llm.callJson<MockInterviewReport>({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "system",
        content: `Job Context (JSON):\n${context.jobSnapshot}`,
      },
      {
        role: "system",
        content: `Candidate Profile:\n${context.profileSnapshot || "No profile context available."}`,
      },
      { role: "user", content: `Interview transcript:\n\n${transcriptText}` },
    ],
    jsonSchema: REPORT_SCHEMA,
    maxRetries: 1,
    retryDelayMs: 300,
    jobId: input.jobId,
  });

  if (!result.success) {
    throw upstreamError("Interview evaluation failed", {
      reason: result.error,
    });
  }

  const data = result.data;
  const competencies = Array.isArray(data.competencies)
    ? data.competencies
        .filter((item) => item && typeof item.name === "string")
        .slice(0, 8)
        .map((item) => ({
          name: item.name.trim(),
          score: clampScore(item.score),
          comment: typeof item.comment === "string" ? item.comment.trim() : "",
        }))
    : [];

  logger.info("Mock interview report generated", {
    jobId: input.jobId,
    round: input.round,
    transcriptTurns: input.transcript.length,
    competencyCount: competencies.length,
  });

  return {
    overallScore: clampScore(data.overallScore),
    recommendation:
      typeof data.recommendation === "string"
        ? data.recommendation.trim()
        : "No recommendation",
    summary: typeof data.summary === "string" ? data.summary.trim() : "",
    strengths: toStringArray(data.strengths),
    improvements: toStringArray(data.improvements),
    competencies,
  };
}
