import { logger } from "@infra/logger";
import type { AiProvider } from "@shared/types";
import { resolveActiveAiProvider } from "../modelSelection";
import {
  computeLlmCacheKey,
  getCachedLlmResponse,
  setCachedLlmResponse,
} from "./cache";
import {
  CLAUDE_CLI_SUGGESTED_MODELS,
  ClaudeCliClient,
} from "./claude-cli/client";
import { CodexCliClient } from "./codex-cli/client";
import { getRetryDelayMs, shouldRetryAttempt } from "./policies/retry-policy";
import type {
  LlmProvider,
  LlmRequestOptions,
  LlmResponse,
  LlmValidationResult,
} from "./types";
import { parseJsonContent } from "./utils/json";

/*
 * Responses are cached per workspace, provider and model, so re-runs over
 * unchanged inputs (re-scoring, re-tailoring) cost nothing.
 */
/** What LlmService needs from a provider CLI client. */
type AiCliClient = {
  callJson(options: LlmRequestOptions<unknown>): Promise<{ text: string }>;
  validateCredentials(signal?: AbortSignal): Promise<LlmValidationResult>;
};

/**
 * JSON calls on the workspace's own AI account: Claude (Claude Code CLI) or
 * ChatGPT (Codex CLI), whichever the person picked in Settings → AI account.
 */
export class LlmService {
  private readonly claudeCliClient: AiCliClient;
  private readonly codexCliClient: AiCliClient;
  private readonly resolveProvider: () => Promise<AiProvider>;

  constructor(
    client: AiCliClient = new ClaudeCliClient(),
    codexClient: AiCliClient = new CodexCliClient(),
    resolveProvider: () => Promise<AiProvider> = resolveActiveAiProvider,
  ) {
    this.claudeCliClient = client;
    this.codexCliClient = codexClient;
    this.resolveProvider = resolveProvider;
  }

  async getProvider(): Promise<LlmProvider> {
    return (await this.resolveProvider()) === "chatgpt"
      ? "codex_cli"
      : "claude_cli";
  }

  private clientFor(provider: LlmProvider): AiCliClient {
    return provider === "codex_cli"
      ? this.codexCliClient
      : this.claudeCliClient;
  }

  async callJson<T>(options: LlmRequestOptions<T>): Promise<LlmResponse<T>> {
    const provider = await this.getProvider();
    const cacheKey = computeLlmCacheKey({
      provider,
      model: options.model,
      messages: options.messages,
      jsonSchema: options.jsonSchema,
    });

    const cached = options.bypassCache ? null : getCachedLlmResponse(cacheKey);
    if (cached !== null) {
      try {
        return { success: true, data: JSON.parse(cached) as T };
      } catch {
        // Corrupt cache entry — fall through and recompute.
      }
    }

    const result = await this.callWithRetries(
      this.clientFor(provider),
      options,
    );
    if (result.success) {
      setCachedLlmResponse(cacheKey, JSON.stringify(result.data));
    }
    return result;
  }

  async validateCredentials(): Promise<LlmValidationResult> {
    return this.clientFor(await this.getProvider()).validateCredentials();
  }

  async listModels(): Promise<string[]> {
    return [...CLAUDE_CLI_SUGGESTED_MODELS];
  }

  private async callWithRetries<T>(
    client: AiCliClient,
    options: LlmRequestOptions<T>,
  ): Promise<LlmResponse<T>> {
    const { maxRetries = 0, retryDelayMs = 500, signal, jobId } = options;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          logger.info("LLM retry attempt", {
            jobId: jobId ?? "unknown",
            attempt,
            maxRetries,
          });
          await sleep(getRetryDelayMs(retryDelayMs, attempt));
        }

        const result = await client.callJson({
          ...(options as LlmRequestOptions<unknown>),
          signal,
        });
        return { success: true, data: parseJsonContent<T>(result.text, jobId) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (attempt < maxRetries && shouldRetryAttempt({ message })) {
          logger.warn("AI CLI attempt failed, retrying", {
            jobId: jobId ?? "unknown",
            attempt: attempt + 1,
            maxRetries,
            message,
          });
          continue;
        }

        return { success: false, error: message };
      }
    }

    return { success: false, error: "All retry attempts failed" };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
