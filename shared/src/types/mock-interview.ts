export const MOCK_INTERVIEW_ROUNDS = ["hr", "technical", "full"] as const;
export type MockInterviewRound = (typeof MOCK_INTERVIEW_ROUNDS)[number];

export const MOCK_INTERVIEW_ROUND_LABELS: Record<MockInterviewRound, string> = {
  hr: "HR / Behavioral",
  technical: "Technical",
  full: "Full loop (HR + Technical)",
};

export const MOCK_INTERVIEW_TURN_ROLES = ["interviewer", "candidate"] as const;
export type MockInterviewTurnRole = (typeof MOCK_INTERVIEW_TURN_ROLES)[number];

export interface MockInterviewTurn {
  role: MockInterviewTurnRole;
  content: string;
}

export interface MockInterviewNextTurn {
  /** The interviewer's next spoken line (a question, follow-up, or closing). */
  message: string;
  /** True once the interviewer has concluded the interview. */
  ended: boolean;
  /** 1-based count of interviewer questions asked so far (for UI progress). */
  questionNumber: number;
}

export interface MockInterviewCompetencyScore {
  name: string;
  /** 0-100. */
  score: number;
  comment: string;
}

export interface MockInterviewReport {
  /** 0-100 overall performance. */
  overallScore: number;
  /** Hiring-style verdict with a one-line rationale. */
  recommendation: string;
  summary: string;
  strengths: string[];
  improvements: string[];
  competencies: MockInterviewCompetencyScore[];
}
