import type {
  MockInterviewNextTurn,
  MockInterviewReport,
  MockInterviewRound,
  MockInterviewTurn,
} from "@shared/types";
import { fetchApi } from "./core";

export async function requestMockInterviewTurn(
  jobId: string,
  input: {
    round: MockInterviewRound;
    transcript: MockInterviewTurn[];
    /** The interview's language, as the screen speaks it. */
    language?: "fr" | "en";
    /** The interviewer's first name (from the chosen voice). */
    interviewerName?: string;
  },
): Promise<MockInterviewNextTurn> {
  return fetchApi<MockInterviewNextTurn>(`/jobs/${jobId}/mock-interview/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function requestMockInterviewReport(
  jobId: string,
  input: { round: MockInterviewRound; transcript: MockInterviewTurn[] },
): Promise<MockInterviewReport> {
  return fetchApi<MockInterviewReport>(`/jobs/${jobId}/mock-interview/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
