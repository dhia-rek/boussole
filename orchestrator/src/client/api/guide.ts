import type {
  GuideApplyProgress,
  GuideNextSteps,
  GuideReviewItem,
} from "@shared/types.js";
import { FOLLOW_UP_REASON_CODE } from "@shared/types.js";
import { fetchApi } from "./core";
import { transitionJobStage } from "./jobs";

export function getGuideNextSteps(): Promise<GuideNextSteps> {
  return fetchApi<GuideNextSteps>("/guide/next-steps");
}

export function getGuideReview(): Promise<GuideReviewItem[]> {
  return fetchApi<GuideReviewItem[]>("/guide/review");
}

export function getGuideApplyProgress(
  jobId: string,
): Promise<GuideApplyProgress> {
  return fetchApi<GuideApplyProgress>(
    `/guide/progress/${encodeURIComponent(jobId)}`,
  );
}

/** Records "I sent a follow-up" on the job's timeline (status unchanged). */
export function logFollowUpSent(jobId: string) {
  return transitionJobStage(jobId, {
    toStage: "no_change",
    metadata: {
      eventType: "note",
      eventLabel: "Followed up",
      reasonCode: FOLLOW_UP_REASON_CODE,
      actor: "user",
    },
  });
}
