import { logger } from "@infra/logger";
import {
  disconnectPostApplicationIntegration,
  getPostApplicationIntegration,
  upsertConnectedPostApplicationIntegration,
} from "@server/repositories/post-application-integrations";
import {
  defaultImapServer,
  type ImapCredentials,
  ImapSignInError,
  parseImapCredentials,
  runImapIngestionSync,
  verifyImapSignIn,
} from "@server/services/post-application/ingestion/imap-sync";
import type { PostApplicationIntegration } from "@shared/types";
import { providerInvalidRequest, providerUpstreamError } from "./errors";
import type {
  PostApplicationProviderActionResult,
  PostApplicationProviderAdapter,
  PostApplicationProviderConnectArgs,
  PostApplicationProviderDisconnectArgs,
  PostApplicationProviderStatusArgs,
  PostApplicationProviderSyncArgs,
} from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST_PATTERN =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/** Reads { email, appPassword, host?, port? } from the connect request. */
export function parseConnectPayload(
  args: PostApplicationProviderConnectArgs,
): ImapCredentials {
  const raw = args.payload?.payload;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw providerInvalidRequest(
      "Enter your email address and an app-specific password.",
    );
  }
  const record = raw as Record<string, unknown>;
  const email = asString(record.email)?.toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) {
    throw providerInvalidRequest("Enter a valid email address.");
  }
  // Shown as xxxx-xxxx-xxxx-xxxx; spaces from copy-paste are dropped.
  const password =
    typeof record.appPassword === "string"
      ? record.appPassword.replace(/\s+/g, "")
      : "";
  if (!password) {
    throw providerInvalidRequest("Enter the app-specific password.");
  }

  const known = defaultImapServer(email);
  const host = asString(record.host)?.toLowerCase() ?? known?.host;
  if (!host) {
    throw providerInvalidRequest(
      "This isn't an iCloud address. Enter your mail provider's IMAP server (for example imap.example.com).",
    );
  }
  if (!HOST_PATTERN.test(host)) {
    throw providerInvalidRequest(
      "Enter the server name only, for example imap.example.com.",
    );
  }
  const port =
    record.port === undefined || record.port === null || record.port === ""
      ? (known?.port ?? 993)
      : Number(record.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw providerInvalidRequest("Enter a port between 1 and 65535.");
  }
  return { email, host, port, password };
}

/** What the browser may see: never the password. */
function toPublicIntegration(
  integration: PostApplicationIntegration | null,
): PostApplicationIntegration | null {
  if (!integration) return null;
  const credentials = parseImapCredentials(integration.credentials);
  return {
    ...integration,
    credentials: credentials
      ? {
          email: credentials.email,
          host: credentials.host,
          port: credentials.port,
          hasPassword: true,
        }
      : { hasPassword: false },
  };
}

function buildStatus(
  accountKey: string,
  integration: PostApplicationIntegration | null,
  message?: string,
): PostApplicationProviderActionResult {
  const publicIntegration = toPublicIntegration(integration);
  return {
    status: {
      provider: "imap",
      accountKey,
      connected:
        publicIntegration?.status === "connected" &&
        publicIntegration.credentials?.hasPassword === true,
      integration: publicIntegration,
    },
    message,
  };
}

function toProviderError(error: unknown, fallback: string): Error {
  if (error instanceof ImapSignInError) {
    return providerInvalidRequest(error.message);
  }
  return providerUpstreamError(
    error instanceof Error ? error.message : fallback,
  );
}

export const imapProvider: PostApplicationProviderAdapter = {
  key: "imap",

  async connect(
    args: PostApplicationProviderConnectArgs,
  ): Promise<PostApplicationProviderActionResult> {
    const credentials = parseConnectPayload(args);
    try {
      await verifyImapSignIn(credentials);
    } catch (error) {
      throw toProviderError(error, "The mail server failed.");
    }

    const integration = await upsertConnectedPostApplicationIntegration({
      provider: "imap",
      accountKey: args.accountKey,
      displayName: credentials.email,
      credentials: { ...credentials },
    });
    logger.info("IMAP mailbox connected", {
      provider: "imap",
      accountKey: args.accountKey,
      initiatedBy: args.initiatedBy ?? null,
      integrationId: integration.id,
    });
    return buildStatus(args.accountKey, integration, "Mailbox connected.");
  },

  async status(
    args: PostApplicationProviderStatusArgs,
  ): Promise<PostApplicationProviderActionResult> {
    const integration = await getPostApplicationIntegration(
      "imap",
      args.accountKey,
    );
    return buildStatus(
      args.accountKey,
      integration,
      integration ? undefined : "No mailbox connected.",
    );
  },

  async sync(
    args: PostApplicationProviderSyncArgs,
  ): Promise<PostApplicationProviderActionResult> {
    const integration = await getPostApplicationIntegration(
      "imap",
      args.accountKey,
    );
    if (!integration) {
      throw providerInvalidRequest(
        `Mailbox '${args.accountKey}' is not connected.`,
      );
    }
    let summary: Awaited<ReturnType<typeof runImapIngestionSync>>;
    try {
      summary = await runImapIngestionSync({
        accountKey: args.accountKey,
        maxMessages: args.payload?.maxMessages,
        searchDays: args.payload?.searchDays,
      });
    } catch (error) {
      throw toProviderError(error, "Mailbox sync failed.");
    }
    const refreshed = await getPostApplicationIntegration(
      "imap",
      args.accountKey,
    );
    logger.info("IMAP sync completed", {
      provider: "imap",
      accountKey: args.accountKey,
      initiatedBy: args.initiatedBy ?? null,
      integrationId: integration.id,
      discovered: summary.discovered,
      relevant: summary.relevant,
      classified: summary.classified,
      errored: summary.errored,
    });
    return buildStatus(
      args.accountKey,
      refreshed,
      `Sync complete: ${summary.discovered} job emails checked, ${summary.relevant} relevant, ${summary.errored} failed.`,
    );
  },

  async disconnect(
    args: PostApplicationProviderDisconnectArgs,
  ): Promise<PostApplicationProviderActionResult> {
    // Deletes the stored password.
    const integration = await disconnectPostApplicationIntegration(
      "imap",
      args.accountKey,
    );
    logger.info("IMAP mailbox disconnected", {
      provider: "imap",
      accountKey: args.accountKey,
      initiatedBy: args.initiatedBy ?? null,
    });
    return buildStatus(
      args.accountKey,
      integration,
      "Mailbox disconnected. You can also delete the app-specific password where you created it.",
    );
  },
};
