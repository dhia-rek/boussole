/**
 * Provider-neutral email ingestion: classify one email with the smart
 * router, save it, and log a timeline event when it is auto-linked to a
 * job. Gmail and IMAP only differ in how they fetch the email.
 */
import { trackServerProductEvent } from "@infra/product-analytics";
import {
  getPostApplicationMessageByExternalId,
  upsertPostApplicationMessage,
} from "@server/repositories/post-application-messages";
import { transitionStage } from "@server/services/applicationTracking";
import { resolveStageTransitionForTarget } from "@server/services/post-application/stage-target";
import type {
  PostApplicationProvider,
  PostApplicationRouterStageTarget,
} from "@shared/types";
import { classifyWithSmartRouter, type minifyActiveJobs } from "./email-router";
import { buildEmailText } from "./gmail-api";

export type IngestionSummary = {
  discovered: number;
  relevant: number;
  classified: number;
  errored: number;
};

export type IngestionContext = {
  provider: PostApplicationProvider;
  accountKey: string;
  integrationId: string;
  syncRunId: string;
  activeJobs: ReturnType<typeof minifyActiveJobs>;
  activeJobIds: ReadonlySet<string>;
};

export type IngestableEmail = {
  externalMessageId: string;
  externalThreadId: string | null;
  /** Raw From header ("Name <address>"). */
  from: string;
  subject: string;
  /** Raw Date header. */
  date: string;
  snippet: string;
  /** Only called for emails not seen before. */
  loadBody: () => Promise<string>;
};

export function parseFromHeader(fromHeader: string): {
  fromAddress: string;
  fromDomain: string | null;
  senderName: string | null;
} {
  const match = fromHeader.match(/^(.*?)<([^>]+)>$/);
  const senderName = match?.[1]?.trim() || null;
  const fromAddress = (match?.[2] || fromHeader).trim().toLowerCase();
  const atIndex = fromAddress.indexOf("@");
  const fromDomain =
    atIndex > 0 ? fromAddress.slice(atIndex + 1).toLowerCase() : null;

  return { fromAddress, fromDomain, senderName };
}

export function parseReceivedAt(dateHeader: string): number {
  const parsed = Date.parse(dateHeader);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function resolveProcessingStatus(input: {
  isAutoLinked: boolean;
  isPendingMatch: boolean;
  isRelevantOrphan: boolean;
}): "auto_linked" | "pending_user" | "ignored" {
  if (input.isAutoLinked) return "auto_linked";
  if (input.isPendingMatch || input.isRelevantOrphan) return "pending_user";
  return "ignored";
}

export function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

async function createAutoStageEvent(args: {
  provider: PostApplicationProvider;
  jobId: string;
  stageTarget: PostApplicationRouterStageTarget;
  receivedAt: number;
  note: string;
}): Promise<void> {
  void trackServerProductEvent(
    "tracking_email_matched",
    {
      provider: args.provider,
      match_mode: "auto_link",
      stage_target: args.stageTarget,
      result: "success",
    },
    { urlPath: "/tracking-inbox" },
  );

  const transition = resolveStageTransitionForTarget(args.stageTarget);
  if (transition.toStage === "no_change") return;

  const eventLabel =
    args.stageTarget === "applied"
      ? "Email received"
      : `Logged from email: ${args.stageTarget}`;

  transitionStage(
    args.jobId,
    transition.toStage,
    Math.floor(args.receivedAt / 1000),
    {
      actor: "system",
      eventType: "status_update",
      eventLabel,
      note: args.note,
      reasonCode: transition.reasonCode ?? "post_application_auto_linked",
    },
    transition.outcome,
  );
}

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, concurrency) }).map(
    async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) return;
        await worker(next);
      }
    },
  );
  await Promise.all(workers);
}

export function routerConcurrency(): number {
  return Math.max(
    1,
    Number.parseInt(
      process.env.POST_APPLICATION_ROUTER_CONCURRENCY ?? "3",
      10,
    ) || 3,
  );
}

/**
 * Classifies and saves one email. Emails seen before keep their earlier
 * classification (no new AI call).
 */
export async function ingestEmail(
  context: IngestionContext,
  email: IngestableEmail,
): Promise<{ relevant: boolean; matched: boolean }> {
  const { fromAddress, fromDomain, senderName } = parseFromHeader(email.from);
  const receivedAt = parseReceivedAt(email.date);
  const base = {
    provider: context.provider,
    accountKey: context.accountKey,
    integrationId: context.integrationId,
    syncRunId: context.syncRunId,
    externalMessageId: email.externalMessageId,
    externalThreadId: email.externalThreadId,
    fromAddress,
    fromDomain,
    senderName,
    subject: email.subject,
    receivedAt,
    snippet: email.snippet,
  };
  const existingMessage = await getPostApplicationMessageByExternalId(
    context.provider,
    context.accountKey,
    email.externalMessageId,
  );

  if (existingMessage) {
    const { message: savedMessage, autoLinkTransitioned } =
      await upsertPostApplicationMessage({
        ...base,
        classificationLabel: existingMessage.classificationLabel,
        classificationConfidence: existingMessage.classificationConfidence,
        classificationPayload: existingMessage.classificationPayload,
        relevanceLlmScore: existingMessage.relevanceLlmScore,
        relevanceDecision: existingMessage.relevanceDecision,
        matchedJobId: existingMessage.matchedJobId,
        matchConfidence: existingMessage.matchConfidence,
        stageTarget: existingMessage.stageTarget,
        messageType: existingMessage.messageType,
        stageEventPayload: existingMessage.stageEventPayload,
        processingStatus: existingMessage.processingStatus,
        existingMessage,
      });
    if (autoLinkTransitioned && savedMessage.matchedJobId) {
      await createAutoStageEvent({
        provider: context.provider,
        jobId: savedMessage.matchedJobId,
        stageTarget: savedMessage.stageTarget ?? "no_change",
        receivedAt: savedMessage.receivedAt,
        note: "Auto-created from Smart Router.",
      });
    }
    return {
      relevant: savedMessage.processingStatus !== "ignored",
      matched: Boolean(savedMessage.matchedJobId),
    };
  }

  const body = await email.loadBody();
  const emailText = buildEmailText({
    from: email.from,
    subject: email.subject,
    date: email.date,
    body,
  });
  const routerResult = await classifyWithSmartRouter({
    emailText,
    activeJobs: context.activeJobs,
  });

  const matchedJobId =
    routerResult.bestMatchId &&
    context.activeJobIds.has(routerResult.bestMatchId)
      ? routerResult.bestMatchId
      : null;
  const isAutoLinked = routerResult.confidence >= 95 && matchedJobId;
  const isPendingMatch = routerResult.confidence >= 50;
  const isRelevantOrphan = routerResult.isRelevant;
  const processingStatus = resolveProcessingStatus({
    isAutoLinked: Boolean(isAutoLinked),
    isPendingMatch,
    isRelevantOrphan,
  });

  const { message: savedMessage, autoLinkTransitioned } =
    await upsertPostApplicationMessage({
      ...base,
      classificationLabel: routerResult.stageTarget,
      classificationConfidence: routerResult.confidence / 100,
      classificationPayload: {
        method: "smart_router",
        reason: routerResult.reason,
        stageTarget: routerResult.stageTarget,
      },
      relevanceLlmScore: routerResult.confidence,
      relevanceDecision: routerResult.isRelevant ? "relevant" : "not_relevant",
      matchedJobId: isAutoLinked || isPendingMatch ? matchedJobId : null,
      matchConfidence: routerResult.confidence,
      stageTarget: routerResult.stageTarget,
      messageType: routerResult.messageType,
      stageEventPayload: routerResult.stageEventPayload,
      processingStatus,
    });

  if (autoLinkTransitioned && savedMessage.matchedJobId) {
    await createAutoStageEvent({
      provider: context.provider,
      jobId: savedMessage.matchedJobId,
      stageTarget: savedMessage.stageTarget ?? "no_change",
      receivedAt: savedMessage.receivedAt,
      note: "Auto-created from Smart Router.",
    });
  }
  return {
    relevant: savedMessage.processingStatus !== "ignored",
    matched: Boolean(savedMessage.matchedJobId),
  };
}
