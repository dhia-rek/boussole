import { beforeEach, describe, expect, it, vi } from "vitest";

const CREDENTIALS = {
  email: "me@icloud.com",
  host: "imap.mail.me.com",
  port: 993,
  password: "abcd-efgh-ijkl-mnop",
};

vi.mock("@server/repositories/post-application-integrations", () => ({
  getPostApplicationIntegration: vi.fn().mockResolvedValue({
    id: "integration-1",
    provider: "imap",
    accountKey: "default",
    displayName: "me@icloud.com",
    status: "connected",
    credentials: {
      email: "me@icloud.com",
      host: "imap.mail.me.com",
      port: 993,
      password: "abcd-efgh-ijkl-mnop",
    },
    lastConnectedAt: null,
    lastSyncedAt: null,
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  updatePostApplicationIntegrationSyncState: vi.fn().mockResolvedValue(null),
}));

vi.mock("@server/repositories/post-application-sync-runs", () => ({
  startPostApplicationSyncRun: vi
    .fn()
    .mockResolvedValue({ id: "sync-run-1", startedAt: Date.now() }),
  completePostApplicationSyncRun: vi.fn().mockResolvedValue(null),
}));

vi.mock("@server/repositories/jobs", () => ({
  getAllJobs: vi.fn().mockResolvedValue([
    {
      id: "job-1",
      employer: "Example Co",
      title: "Data Engineer",
      status: "applied",
    },
  ]),
}));

const getPostApplicationMessageByExternalId = vi.fn();
const upsertPostApplicationMessage = vi.fn();
vi.mock("@server/repositories/post-application-messages", () => ({
  getPostApplicationMessageByExternalId,
  upsertPostApplicationMessage,
}));

const transitionStage = vi.fn();
vi.mock("@server/services/applicationTracking", () => ({
  transitionStage,
}));

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

const events: string[] = [];
const llmCallJson = vi.fn();
vi.mock("@server/services/llm/service", () => ({
  LlmService: class {
    callJson() {
      return llmCallJson();
    }
  },
}));

type FakeMessage = {
  uid: number;
  from: { name: string; address: string };
  subject: string;
  messageId: string;
  inReplyTo?: string;
  body: string;
};

const MAILBOX: FakeMessage[] = [
  {
    uid: 11,
    from: { name: "Shop", address: "news@shop.com" },
    subject: "Our newsletter",
    messageId: "<n@shop.com>",
    body: "Sale!",
  },
  {
    uid: 12,
    from: { name: "Acme Talent", address: "jobs@acme.fr" },
    subject: "Votre candidature chez Acme",
    messageId: "<a@acme.fr>",
    body: "Merci pour votre candidature. Nous revenons vers vous.",
  },
  {
    uid: 13,
    from: { name: "Marie", address: "marie@example.co" },
    subject: "Re: notre échange",
    messageId: "<b@example.co>",
    inReplyTo: "<x@icloud.com>",
    body: "Seriez-vous disponible pour un entretien technique ?",
  },
  {
    uid: 14,
    from: { name: "Shop", address: "orders@shop.com" },
    subject: "Votre commande",
    messageId: "<c@shop.com>",
    body: "Livraison demain.",
  },
];

function rawEmail(message: FakeMessage): Buffer {
  return Buffer.from(
    [
      `From: ${message.from.name} <${message.from.address}>`,
      "To: me@icloud.com",
      `Subject: ${message.subject}`,
      `Message-ID: ${message.messageId}`,
      `Date: ${new Date().toUTCString()}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      message.body,
      "",
    ].join("\r\n"),
  );
}

class FakeSession {
  connectError: unknown = null;
  constructor(readonly messages: FakeMessage[]) {}
  async connect() {
    events.push("connect");
    if (this.connectError) throw this.connectError;
  }
  async logout() {
    events.push("logout");
  }
  close() {
    events.push("close");
  }
  async getMailboxLock() {
    return { release: () => events.push("release") };
  }
  async search() {
    return this.messages.map((message) => message.uid);
  }
  async *fetch(
    range: number[],
    query: { source?: { maxLength: number }; envelope?: true },
  ) {
    events.push(
      `${query.source ? "download" : "envelopes"}:${range.join(",")}`,
    );
    for (const message of this.messages.filter((m) => range.includes(m.uid))) {
      if (query.source) {
        yield { uid: message.uid, source: rawEmail(message) };
      } else {
        yield {
          uid: message.uid,
          envelope: {
            subject: message.subject,
            messageId: message.messageId,
            inReplyTo: message.inReplyTo,
            date: new Date(),
            from: [message.from],
          },
        };
      }
    }
  }
}

async function useFakeMailbox(session = new FakeSession(MAILBOX)) {
  const imap = await import("./imap-sync");
  const created: Array<{ host: string; address: string }> = [];
  imap.__setImapTestHooks({
    resolveHost: async () => ["17.57.152.5"],
    createSession: (credentials, address) => {
      created.push({ host: credentials.host, address });
      return session as never;
    },
  });
  return { imap, session, created };
}

describe("IMAP sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    events.length = 0;
    llmCallJson.mockImplementation(async () => {
      events.push("ai");
      return {
        success: true,
        data: {
          bestMatchIndex: 1,
          confidence: 99,
          stageTarget: "assessment",
          isRelevant: true,
          stageEventPayload: null,
          reason: "matches",
        },
      };
    });
    upsertPostApplicationMessage.mockImplementation(
      async (input: Record<string, unknown>) => ({
        message: { ...input, id: `saved-${String(input.externalMessageId)}` },
        autoLinkTransitioned: input.processingStatus === "auto_linked",
      }),
    );
  });

  it("downloads and classifies only likely job emails, after closing the mailbox", async () => {
    getPostApplicationMessageByExternalId.mockResolvedValue(null);
    const { imap, created } = await useFakeMailbox();

    const summary = await imap.runImapIngestionSync({ accountKey: "default" });

    expect(summary).toEqual({
      discovered: 2,
      relevant: 2,
      classified: 2,
      errored: 0,
    });
    // Senders and subjects of all, then only the two job emails, newest first.
    expect(events.slice(0, 5)).toEqual([
      "connect",
      "envelopes:11,12,13,14",
      "download:13,12",
      "release",
      "logout",
    ]);
    expect(events.filter((event) => event === "ai")).toHaveLength(2);
    expect(events.indexOf("logout")).toBeLessThan(events.indexOf("ai"));
    // Connected to the checked address, certificate checked for the name.
    expect(created).toEqual([
      { host: "imap.mail.me.com", address: "17.57.152.5" },
    ]);

    const saved = upsertPostApplicationMessage.mock.calls.map(
      ([input]) => input as Record<string, unknown>,
    );
    const reply = saved.find(
      (input) => input.externalMessageId === "<b@example.co>",
    );
    expect(reply).toMatchObject({
      provider: "imap",
      externalThreadId: "<x@icloud.com>",
      fromAddress: "marie@example.co",
      senderName: "Marie",
      subject: "Re: notre échange",
      processingStatus: "auto_linked",
      matchedJobId: "job-1",
    });
    expect(String(reply?.snippet)).toContain("entretien technique");
    expect(transitionStage).toHaveBeenCalledTimes(2);
  });

  it("skips emails it already classified: no download, no AI call", async () => {
    getPostApplicationMessageByExternalId.mockResolvedValue({
      id: "existing",
      snippet: "earlier snippet",
      classificationLabel: "applied",
      classificationConfidence: 0.6,
      classificationPayload: null,
      relevanceLlmScore: 60,
      relevanceDecision: "relevant",
      matchedJobId: null,
      matchConfidence: 60,
      stageTarget: "applied",
      messageType: "update",
      stageEventPayload: null,
      processingStatus: "pending_user",
    });
    const { imap } = await useFakeMailbox();

    await imap.runImapIngestionSync({ accountKey: "default" });

    expect(events.some((event) => event.startsWith("download"))).toBe(false);
    expect(llmCallJson).not.toHaveBeenCalled();
    expect(upsertPostApplicationMessage).toHaveBeenCalledWith(
      expect.objectContaining({ snippet: "earlier snippet" }),
    );
  });

  it("refuses mail servers on private addresses", async () => {
    const { imap, created } = await useFakeMailbox();
    imap.__setImapTestHooks({ resolveHost: async () => ["10.0.0.5"] });
    await expect(
      imap.verifyImapSignIn({ ...CREDENTIALS, host: "mail.internal.example" }),
    ).rejects.toThrow("Only public mail servers can be used.");
    await expect(
      imap.verifyImapSignIn({ ...CREDENTIALS, host: "localhost" }),
    ).rejects.toThrow("Only public mail servers can be used.");
    expect(created).toEqual([]);
  });

  it("explains a refused sign-in", async () => {
    const session = new FakeSession([]);
    session.connectError = Object.assign(new Error("Authentication failed"), {
      authenticationFailed: true,
    });
    const { imap } = await useFakeMailbox(session);

    const error = await imap
      .verifyImapSignIn(CREDENTIALS)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(imap.ImapSignInError);
    expect(String((error as Error).message)).toContain("app-specific password");
    expect(events).toContain("close");
  });

  it("reads HTML-only emails as text", async () => {
    const { bodyTextOf } = await import("./imap-sync");
    const source = Buffer.from(
      "Subject: Entretien\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Bonjour,</p><p>Seriez-vous <b>disponible</b> jeudi ?</p>\r\n",
    );
    expect(await bodyTextOf(source)).toContain("Seriez-vous disponible jeudi");
  });
});
