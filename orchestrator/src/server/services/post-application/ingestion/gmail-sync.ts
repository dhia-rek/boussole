import { logger } from "@infra/logger";
import { getAllJobs } from "@server/repositories/jobs";
import {
  getPostApplicationIntegration,
  updatePostApplicationIntegrationSyncState,
  upsertConnectedPostApplicationIntegration,
} from "@server/repositories/post-application-integrations";
import {
  completePostApplicationSyncRun,
  startPostApplicationSyncRun,
} from "@server/repositories/post-application-sync-runs";
import { minifyActiveJobs } from "./email-router";
import type { GmailCredentials } from "./gmail-api";
import {
  buildEmailText,
  extractBodyText,
  getMessageFull,
  getMessageMetadata,
  listMessageIds,
  resolveGmailAccessToken,
} from "./gmail-api";
import {
  type IngestionSummary,
  ingestEmail,
  normalizeErrorMessage,
  routerConcurrency,
  runWithConcurrency,
} from "./ingest-message";

const DEFAULT_SEARCH_DAYS = 90;
const DEFAULT_MAX_MESSAGES = 100;

export type GmailSyncSummary = IngestionSummary;

export const __test__ = {
  extractBodyText,
  buildEmailText,
};

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseGmailCredentials(
  credentials: Record<string, unknown> | null,
): GmailCredentials | null {
  if (!credentials) return null;
  const refreshToken = asString(credentials.refreshToken);
  if (!refreshToken) return null;

  const accessToken = asString(credentials.accessToken) ?? undefined;
  const expiryDate =
    typeof credentials.expiryDate === "number" &&
    Number.isFinite(credentials.expiryDate)
      ? credentials.expiryDate
      : undefined;

  return {
    refreshToken,
    accessToken,
    expiryDate,
    scope: asString(credentials.scope) ?? undefined,
    tokenType: asString(credentials.tokenType) ?? undefined,
    email: asString(credentials.email) ?? undefined,
  };
}

function headerValue(
  headers: Array<{ name?: string; value?: string }>,
  name: string,
): string {
  const found = headers.find(
    (header) => (header.name ?? "").toLowerCase() === name.toLowerCase(),
  );
  return String(found?.value ?? "");
}

export async function runGmailIngestionSync(args: {
  accountKey: string;
  maxMessages?: number;
  searchDays?: number;
}): Promise<GmailSyncSummary> {
  const integration = await getPostApplicationIntegration(
    "gmail",
    args.accountKey,
  );
  const parsedCredentials = parseGmailCredentials(
    integration?.credentials ?? null,
  );
  if (!integration || !parsedCredentials) {
    throw new Error(`Gmail account '${args.accountKey}' is not connected.`);
  }

  const searchDays = Math.max(1, args.searchDays ?? DEFAULT_SEARCH_DAYS);
  const maxMessages = Math.max(1, args.maxMessages ?? DEFAULT_MAX_MESSAGES);

  const syncRun = await startPostApplicationSyncRun({
    provider: "gmail",
    accountKey: args.accountKey,
    integrationId: integration.id,
  });

  let discovered = 0;
  let relevant = 0;
  let classified = 0;
  let matched = 0;
  let errored = 0;

  try {
    const resolvedCredentials =
      await resolveGmailAccessToken(parsedCredentials);
    if (!resolvedCredentials.accessToken) {
      throw new Error("Gmail sync failed to resolve access token.");
    }
    const accessToken = resolvedCredentials.accessToken;

    if (
      resolvedCredentials.accessToken !== parsedCredentials.accessToken ||
      resolvedCredentials.expiryDate !== parsedCredentials.expiryDate
    ) {
      await upsertConnectedPostApplicationIntegration({
        provider: "gmail",
        accountKey: args.accountKey,
        displayName: integration.displayName,
        credentials: {
          refreshToken: resolvedCredentials.refreshToken,
          accessToken: resolvedCredentials.accessToken,
          expiryDate: resolvedCredentials.expiryDate,
          scope: resolvedCredentials.scope,
          tokenType: resolvedCredentials.tokenType,
          email: resolvedCredentials.email,
        },
      });
    }

    const messageIds = await listMessageIds(
      accessToken,
      searchDays,
      maxMessages,
    );
    const activeJobs = await getAllJobs([
      "applied",
      "in_progress",
      "processing",
    ]);
    const activeJobMinified = minifyActiveJobs(activeJobs);
    const context = {
      provider: "gmail" as const,
      accountKey: args.accountKey,
      integrationId: integration.id,
      syncRunId: syncRun.id,
      activeJobs: activeJobMinified,
      activeJobIds: new Set(activeJobMinified.map((job) => job.id)),
    };

    await runWithConcurrency(
      messageIds,
      routerConcurrency(),
      async (message) => {
        discovered += 1;

        try {
          const metadata = await getMessageMetadata(accessToken, message.id);
          const result = await ingestEmail(context, {
            externalMessageId: metadata.id,
            externalThreadId: metadata.threadId,
            from: headerValue(metadata.headers, "From"),
            subject: headerValue(metadata.headers, "Subject"),
            date: headerValue(metadata.headers, "Date"),
            snippet: metadata.snippet,
            loadBody: async () =>
              extractBodyText(
                (await getMessageFull(accessToken, message.id)).payload,
              ),
          });
          classified += 1;
          if (result.relevant) relevant += 1;
          if (result.matched) matched += 1;
        } catch (error) {
          errored += 1;
          logger.warn("Failed to ingest Gmail message", {
            provider: "gmail",
            accountKey: args.accountKey,
            externalMessageId: message.id,
            syncRunId: syncRun.id,
            error: normalizeErrorMessage(error),
          });
        }
      },
    );

    await completePostApplicationSyncRun({
      id: syncRun.id,
      status: "completed",
      messagesDiscovered: discovered,
      messagesRelevant: relevant,
      messagesClassified: classified,
      messagesMatched: matched,
      messagesErrored: errored,
    });
    await updatePostApplicationIntegrationSyncState({
      provider: "gmail",
      accountKey: args.accountKey,
      lastSyncedAt: Date.now(),
      lastError: null,
      status: "connected",
    });

    return { discovered, relevant, classified, errored };
  } catch (error) {
    const errorMessage = normalizeErrorMessage(error);
    await completePostApplicationSyncRun({
      id: syncRun.id,
      status: "failed",
      messagesDiscovered: discovered,
      messagesRelevant: relevant,
      messagesClassified: classified,
      messagesMatched: matched,
      messagesErrored: errored,
      errorCode: "GMAIL_SYNC_FAILED",
      errorMessage,
    });
    await updatePostApplicationIntegrationSyncState({
      provider: "gmail",
      accountKey: args.accountKey,
      lastSyncedAt: Date.now(),
      lastError: errorMessage,
      status: "error",
    });

    throw error;
  }
}
