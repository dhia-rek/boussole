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
import { resolveLlmRuntimeSettings } from "./modelSelection";

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

function interviewerSystemPrompt(round: MockInterviewRound): string {
  return [
    `You are a professional hiring interviewer running a realistic ${MOCK_INTERVIEW_ROUND_LABELS[round]} interview for the role described in the job context.`,
    roundGuidance(round),
    "Rules:",
    "- Stay strictly in character as the interviewer. Never break character, never give feedback, scores, hints, or coaching during the interview.",
    "- Ask exactly ONE question or follow-up per turn. Keep it concise and natural, the way a person speaks aloud.",
    "- Use the candidate's previous answer to ask relevant, progressively deeper follow-ups. Use the job description and candidate profile to make questions specific.",
    "- Open the interview with a brief greeting and your first question.",
    '- After roughly 6-10 questions (more for a full loop), wrap up: set "ended" to true and make "message" a short, professional closing statement (no question, no evaluation).',
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
  signal?: AbortSignal;
}): Promise<MockInterviewNextTurn> {
  const context = await buildJobChatPromptContext(input.jobId);
  const llmConfig = await resolveLlmRuntimeSettings("tailoring");

  const llm = new LlmService({
    provider: llmConfig.provider,
    baseUrl: llmConfig.baseUrl,
    apiKey: llmConfig.apiKey,
  });

  const messages: LlmMessage[] = [
    { role: "system", content: interviewerSystemPrompt(input.round) },
    { role: "system", content: `Job Context (JSON):\n${context.jobSnapshot}` },
    {
      role: "system",
      content: `Candidate Profile:\n${context.profileSnapshot || "No profile context available."}`,
    },
    ...transcriptToLlmMessages(input.transcript),
  ];

  const result = await llm.callJson<{ message: string; ended: boolean }>({
    model: llmConfig.model,
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
  const llmConfig = await resolveLlmRuntimeSettings("tailoring");

  const llm = new LlmService({
    provider: llmConfig.provider,
    baseUrl: llmConfig.baseUrl,
    apiKey: llmConfig.apiKey,
  });

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
    model: llmConfig.model,
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
