import type {
  BranchInfo,
  JobChatImageAttachment,
  JobChatMessage,
  JobChatStreamEvent,
} from "@shared/types";
import { fetchApi, streamSseEvents, withQuery } from "./core";

type GhostwriterContextSelectionInput = {
  selectedNoteIds?: string[];
  selectedEmailIds?: string[];
};

type GhostwriterContextSelectionResult = {
  selectedNoteIds: string[];
  selectedEmailIds: string[];
};

type GhostwriterMessageContextInput = GhostwriterContextSelectionInput & {
  content: string;
  attachments?: JobChatImageAttachment[];
};

type GhostwriterStreamSignalInput = GhostwriterContextSelectionInput & {
  signal?: AbortSignal;
};

export async function listJobGhostwriterMessages(
  jobId: string,
  options?: { limit?: number; offset?: number },
): Promise<
  {
    messages: JobChatMessage[];
    branches: BranchInfo[];
  } & GhostwriterContextSelectionResult
> {
  return fetchApi<
    {
      messages: JobChatMessage[];
      branches: BranchInfo[];
    } & GhostwriterContextSelectionResult
  >(
    withQuery(`/jobs/${jobId}/chat/messages`, {
      limit: options?.limit,
      offset: options?.offset,
    }),
  );
}

export async function updateJobGhostwriterContext(
  jobId: string,
  input: GhostwriterContextSelectionInput,
): Promise<GhostwriterContextSelectionResult> {
  return fetchApi<GhostwriterContextSelectionResult>(
    `/jobs/${jobId}/chat/context`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export async function streamJobGhostwriterMessage(
  jobId: string,
  input: GhostwriterMessageContextInput & { signal?: AbortSignal },
  handlers: {
    onEvent: (event: JobChatStreamEvent) => void;
  },
): Promise<void> {
  return streamSseEvents<JobChatStreamEvent>(
    `/jobs/${jobId}/chat/messages`,
    {
      content: input.content,
      selectedNoteIds: input.selectedNoteIds,
      selectedEmailIds: input.selectedEmailIds,
      attachments: input.attachments,
      stream: true,
    },
    {
      onEvent: handlers.onEvent,
      signal: input.signal,
    },
  );
}

export async function resetJobGhostwriterConversation(
  jobId: string,
): Promise<{ deletedMessages: number; deletedRuns: number }> {
  return fetchApi(`/jobs/${jobId}/chat/reset`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function cancelJobGhostwriterRun(
  jobId: string,
  runId: string,
): Promise<{ cancelled: boolean; alreadyFinished: boolean }> {
  return fetchApi(
    `/jobs/${jobId}/chat/runs/${encodeURIComponent(runId)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function streamRegenerateJobGhostwriterMessage(
  jobId: string,
  assistantMessageId: string,
  input: GhostwriterStreamSignalInput,
  handlers: {
    onEvent: (event: JobChatStreamEvent) => void;
  },
): Promise<void> {
  return streamSseEvents<JobChatStreamEvent>(
    `/jobs/${jobId}/chat/messages/${encodeURIComponent(assistantMessageId)}/regenerate`,
    {
      selectedNoteIds: input.selectedNoteIds,
      selectedEmailIds: input.selectedEmailIds,
      stream: true,
    },
    {
      onEvent: handlers.onEvent,
      signal: input.signal,
    },
  );
}

export async function editJobGhostwriterMessage(
  jobId: string,
  messageId: string,
  input: GhostwriterMessageContextInput & {
    content: string;
    signal?: AbortSignal;
  },
  handlers: {
    onEvent: (event: JobChatStreamEvent) => void;
  },
): Promise<void> {
  return streamSseEvents<JobChatStreamEvent>(
    `/jobs/${jobId}/chat/messages/${encodeURIComponent(messageId)}/edit`,
    {
      content: input.content,
      selectedNoteIds: input.selectedNoteIds,
      selectedEmailIds: input.selectedEmailIds,
      attachments: input.attachments,
      stream: true,
    },
    {
      onEvent: handlers.onEvent,
      signal: input.signal,
    },
  );
}

export async function switchJobGhostwriterBranch(
  jobId: string,
  messageId: string,
): Promise<{ messages: JobChatMessage[]; branches: BranchInfo[] }> {
  return fetchApi(
    `/jobs/${jobId}/chat/messages/${encodeURIComponent(messageId)}/switch-branch`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}
