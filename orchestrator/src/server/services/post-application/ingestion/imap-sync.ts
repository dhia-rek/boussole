/**
 * Email tracking for IMAP mailboxes (iCloud Mail by default). Reads sender
 * and subject of recent inbox messages, keeps the likely job emails, and
 * downloads only those before classifying them like Gmail does. The
 * mailbox is only read, never changed.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { logger } from "@infra/logger";
import { isPublicIpAddress } from "@infra/public-url";
import { getAllJobs } from "@server/repositories/jobs";
import {
  getPostApplicationIntegration,
  updatePostApplicationIntegrationSyncState,
} from "@server/repositories/post-application-integrations";
import { getPostApplicationMessageByExternalId } from "@server/repositories/post-application-messages";
import {
  completePostApplicationSyncRun,
  startPostApplicationSyncRun,
} from "@server/repositories/post-application-sync-runs";
import { normalizeWhitespace } from "@shared/utils/string";
import { convert } from "html-to-text";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { minifyActiveJobs } from "./email-router";
import {
  type IngestableEmail,
  type IngestionSummary,
  ingestEmail,
  normalizeErrorMessage,
  routerConcurrency,
  runWithConcurrency,
} from "./ingest-message";
import { employerKeys, isLikelyJobEmail } from "./job-email-filter";

const DEFAULT_SEARCH_DAYS = 90;
const DEFAULT_MAX_MESSAGES = 100;
/** Most recent inbox messages whose sender and subject are checked. */
const MAX_SCANNED = 2000;
/** Enough for the text of any email; attachments are cut off. */
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_BODY_CHARS = 20_000;
const TIMEOUT_MS = 20_000;
const DAY_MS = 86_400_000;

export const ICLOUD_IMAP_SERVER = { host: "imap.mail.me.com", port: 993 };
const ICLOUD_DOMAINS = new Set(["icloud.com", "me.com", "mac.com"]);

export type ImapCredentials = {
  email: string;
  host: string;
  port: number;
  password: string;
};

/** iCloud addresses need no server settings. */
export function defaultImapServer(
  email: string,
): { host: string; port: number } | null {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return ICLOUD_DOMAINS.has(domain) ? ICLOUD_IMAP_SERVER : null;
}

export function parseImapCredentials(
  raw: Record<string, unknown> | null | undefined,
): ImapCredentials | null {
  if (!raw) return null;
  const email = typeof raw.email === "string" ? raw.email.trim() : "";
  const host = typeof raw.host === "string" ? raw.host.trim() : "";
  const password = typeof raw.password === "string" ? raw.password : "";
  const port = typeof raw.port === "number" ? raw.port : Number.NaN;
  if (!email || !host || !password || !Number.isInteger(port)) return null;
  return { email, host, port, password };
}

type FetchedMessage = {
  uid: number;
  envelope?: {
    date?: Date | string;
    subject?: string;
    messageId?: string;
    inReplyTo?: string;
    from?: Array<{ name?: string; address?: string }>;
  };
  source?: Buffer;
};

/** The few IMAP calls Boussole makes; tests swap in a fake. */
export interface ImapSession {
  connect(): Promise<void>;
  logout(): Promise<void>;
  close(): void;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  search(
    query: { since: Date },
    options: { uid: true },
  ): Promise<number[] | false | undefined>;
  fetch(
    range: number[],
    query: {
      uid: true;
      envelope?: true;
      source?: { maxLength: number };
    },
    options: { uid: true },
  ): AsyncIterable<FetchedMessage>;
}

function defaultSessionFactory(
  credentials: ImapCredentials,
  address: string,
): ImapSession {
  return new ImapFlow({
    // Connect to the address checked below; the certificate is still
    // verified against the server name.
    host: address,
    ...(isIP(credentials.host) ? {} : { servername: credentials.host }),
    port: credentials.port,
    secure: true,
    auth: { user: credentials.email, pass: credentials.password },
    // Never log: the library would print commands and server replies.
    logger: false,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: 2 * 60 * 1000,
    disableAutoIdle: true,
  }) as unknown as ImapSession;
}

type ResolveHost = (hostname: string) => Promise<string[]>;
const resolveWithDns: ResolveHost = async (hostname) =>
  (await dnsLookup(hostname, { all: true })).map((entry) => entry.address);

let createSession = defaultSessionFactory;
let resolveHost = resolveWithDns;

export function __setImapTestHooks(
  hooks: {
    createSession?: (
      credentials: ImapCredentials,
      address: string,
    ) => ImapSession;
    resolveHost?: ResolveHost;
  } | null,
): void {
  createSession = hooks?.createSession ?? defaultSessionFactory;
  resolveHost = hooks?.resolveHost ?? resolveWithDns;
}

export class ImapSignInError extends Error {}

/**
 * Only public mail servers: on a shared Boussole, a server name pointing
 * at a private address would let someone probe the server's network.
 */
async function publicAddressOf(host: string): Promise<string> {
  const name = host.trim().toLowerCase();
  if (!name || name === "localhost" || name.endsWith(".localhost")) {
    throw new ImapSignInError("Only public mail servers can be used.");
  }
  let addresses: string[];
  if (isIP(name)) {
    addresses = [name];
  } else {
    try {
      addresses = await resolveHost(name);
    } catch {
      throw new ImapSignInError(`The mail server ${host} could not be found.`);
    }
  }
  const [first] = addresses;
  if (!first || !addresses.every(isPublicIpAddress)) {
    throw new ImapSignInError("Only public mail servers can be used.");
  }
  return first;
}

async function openSession(credentials: ImapCredentials): Promise<ImapSession> {
  const address = await publicAddressOf(credentials.host);
  return createSession(credentials, address);
}

/** A clear reason instead of a raw server reply. */
function describeImapError(error: unknown, host: string): Error {
  const record = (error ?? {}) as {
    authenticationFailed?: boolean;
    code?: string;
  };
  if (record.authenticationFailed) {
    return new ImapSignInError(
      "The mail server refused the sign-in. Check the email address and use an app-specific password (for iCloud: account.apple.com → Sign-In and Security → App-Specific Passwords), not your usual password.",
    );
  }
  if (
    record.code === "ENOTFOUND" ||
    record.code === "ECONNREFUSED" ||
    record.code === "ETIMEDOUT" ||
    record.code === "ECONNRESET"
  ) {
    return new Error(
      `Could not reach the mail server ${host}. Check the server name and your internet connection.`,
    );
  }
  return new Error(
    `The mail server ${host} failed: ${normalizeErrorMessage(error)}`,
  );
}

/** Signs in and out once, to check the address and password. */
export async function verifyImapSignIn(
  credentials: ImapCredentials,
): Promise<void> {
  const session = await openSession(credentials);
  try {
    await session.connect();
  } catch (error) {
    session.close();
    throw describeImapError(error, credentials.host);
  }
  await session.logout().catch(() => session.close());
}

function fromHeaderOf(message: FetchedMessage): {
  header: string;
  fromAddress: string;
  senderName: string;
} {
  const from = message.envelope?.from?.[0];
  const fromAddress = (from?.address ?? "").trim();
  const senderName = (from?.name ?? "").trim();
  return {
    header: senderName ? `${senderName} <${fromAddress}>` : fromAddress,
    fromAddress,
    senderName,
  };
}

function dateHeaderOf(message: FetchedMessage): string {
  const date = message.envelope?.date;
  if (date instanceof Date) return date.toISOString();
  return typeof date === "string" ? date : "";
}

/** The email's text: plain text when there is some, else its HTML as text. */
export async function bodyTextOf(source: Buffer): Promise<string> {
  const parsed = await simpleParser(source);
  const text =
    typeof parsed.text === "string" && parsed.text.trim()
      ? parsed.text
      : typeof parsed.html === "string"
        ? convert(parsed.html, { wordwrap: false })
        : "";
  return text.trim().slice(0, MAX_BODY_CHARS);
}

type Candidate = {
  uid: number;
  externalMessageId: string;
  externalThreadId: string | null;
  from: string;
  subject: string;
  date: string;
};

export async function runImapIngestionSync(args: {
  accountKey: string;
  maxMessages?: number;
  searchDays?: number;
}): Promise<IngestionSummary> {
  const integration = await getPostApplicationIntegration(
    "imap",
    args.accountKey,
  );
  const credentials = parseImapCredentials(integration?.credentials);
  if (!integration || !credentials) {
    throw new Error(`Mailbox '${args.accountKey}' is not connected.`);
  }
  const searchDays = Math.max(1, args.searchDays ?? DEFAULT_SEARCH_DAYS);
  const maxMessages = Math.max(1, args.maxMessages ?? DEFAULT_MAX_MESSAGES);

  const syncRun = await startPostApplicationSyncRun({
    provider: "imap",
    accountKey: args.accountKey,
    integrationId: integration.id,
  });
  let discovered = 0;
  let relevant = 0;
  let classified = 0;
  let matched = 0;
  let errored = 0;

  try {
    const activeJobs = await getAllJobs([
      "applied",
      "in_progress",
      "processing",
    ]);
    const activeJobMinified = minifyActiveJobs(activeJobs);
    const employers = employerKeys(activeJobs.map((job) => job.employer));

    // 1. Read the mailbox (senders, subjects, then the kept emails only).
    const candidates: Candidate[] = [];
    const bodies = new Map<string, string>();
    const snippets = new Map<string, string>();
    const session = await openSession(credentials);
    try {
      await session.connect();
    } catch (error) {
      session.close();
      throw describeImapError(error, credentials.host);
    }
    try {
      const lock = await session.getMailboxLock("INBOX");
      try {
        const found = await session.search(
          { since: new Date(Date.now() - searchDays * DAY_MS) },
          { uid: true },
        );
        const uids = (found || []).slice(-MAX_SCANNED);
        const scanned: FetchedMessage[] = [];
        if (uids.length > 0) {
          for await (const message of session.fetch(
            uids,
            { uid: true, envelope: true },
            { uid: true },
          )) {
            scanned.push(message);
          }
        }
        // Newest first; keep the likely job emails.
        scanned.sort((a, b) => b.uid - a.uid);
        for (const message of scanned) {
          const from = fromHeaderOf(message);
          const subject = message.envelope?.subject ?? "";
          if (
            !isLikelyJobEmail(
              {
                fromAddress: from.fromAddress,
                senderName: from.senderName,
                subject,
              },
              employers,
            )
          ) {
            continue;
          }
          const messageId = message.envelope?.messageId?.trim();
          candidates.push({
            uid: message.uid,
            externalMessageId: messageId || `uid:${message.uid}`,
            externalThreadId:
              message.envelope?.inReplyTo?.trim() || messageId || null,
            from: from.header,
            subject,
            date: dateHeaderOf(message),
          });
          if (candidates.length >= maxMessages) break;
        }

        // Only download emails not classified before.
        const toDownload: number[] = [];
        for (const candidate of candidates) {
          const existing = await getPostApplicationMessageByExternalId(
            "imap",
            args.accountKey,
            candidate.externalMessageId,
          );
          if (existing) {
            snippets.set(candidate.externalMessageId, existing.snippet);
          } else {
            toDownload.push(candidate.uid);
          }
        }
        if (toDownload.length > 0) {
          const idByUid = new Map(
            candidates.map((candidate) => [
              candidate.uid,
              candidate.externalMessageId,
            ]),
          );
          for await (const message of session.fetch(
            toDownload,
            { uid: true, source: { maxLength: MAX_SOURCE_BYTES } },
            { uid: true },
          )) {
            const id = idByUid.get(message.uid);
            if (!id || !message.source) continue;
            const body = await bodyTextOf(message.source).catch(() => "");
            bodies.set(id, body);
            snippets.set(id, normalizeWhitespace(body).slice(0, 200));
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await session.logout().catch(() => session.close());
    }

    // 2. Classify with the mailbox already closed.
    const context = {
      provider: "imap" as const,
      accountKey: args.accountKey,
      integrationId: integration.id,
      syncRunId: syncRun.id,
      activeJobs: activeJobMinified,
      activeJobIds: new Set(activeJobMinified.map((job) => job.id)),
    };
    await runWithConcurrency(
      candidates,
      routerConcurrency(),
      async (candidate) => {
        discovered += 1;
        const email: IngestableEmail = {
          externalMessageId: candidate.externalMessageId,
          externalThreadId: candidate.externalThreadId,
          from: candidate.from,
          subject: candidate.subject,
          date: candidate.date,
          snippet: snippets.get(candidate.externalMessageId) ?? "",
          loadBody: async () => bodies.get(candidate.externalMessageId) ?? "",
        };
        try {
          const result = await ingestEmail(context, email);
          classified += 1;
          if (result.relevant) relevant += 1;
          if (result.matched) matched += 1;
        } catch (error) {
          errored += 1;
          logger.warn("Failed to ingest IMAP message", {
            provider: "imap",
            accountKey: args.accountKey,
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
      provider: "imap",
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
      errorCode: "IMAP_SYNC_FAILED",
      errorMessage,
    });
    await updatePostApplicationIntegrationSyncState({
      provider: "imap",
      accountKey: args.accountKey,
      lastSyncedAt: Date.now(),
      lastError: errorMessage,
      status: "error",
    });
    throw error;
  }
}
