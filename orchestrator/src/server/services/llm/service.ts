import { logger } from "@infra/logger";
import {
  computeLlmCacheKey,
  getCachedLlmResponse,
  setCachedLlmResponse,
} from "./cache";
import {
  CLAUDE_CLI_SUGGESTED_MODELS,
  ClaudeCliClient,
} from "./claude-cli/client";
import { getRetryDelayMs, shouldRetryAttempt } from "./policies/retry-policy";
import type {
  LlmProvider,
  LlmRequestOptions,
  LlmResponse,
  LlmValidationResult,
} from "./types";
import { parseJsonContent } from "./utils/json";

/**
 * Structured (JSON) calls to Claude through the Claude Code CLI, which runs on
 * the user's Claude subscription: no API key. Responses are cached so re-runs
 * over unchanged inputs (re-scoring, re-tailoring) cost nothing.
 */
export class LlmService {
  private readonly claudeCliClient: ClaudeCliClient;

  constructor(client: ClaudeCliClient = new ClaudeCliClient()) {
    this.claudeCliClient = client;
  }

  getProvider(): LlmProvider {
    return "claude_cli";
  }

  async callJson<T>(options: LlmRequestOptions<T>): Promise<LlmResponse<T>> {
    const cacheKey = computeLlmCacheKey({
      provider: this.getProvider(),
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

    const result = await this.callClaude(options);
    if (result.success) {
      setCachedLlmResponse(cacheKey, JSON.stringify(result.data));
    }
    return result;
  }

  async validateCredentials(): Promise<LlmValidationResult> {
    return this.claudeCliClient.validateCredentials();
  }

  async listModels(): Promise<string[]> {
    return [...CLAUDE_CLI_SUGGESTED_MODELS];
  }

  private async callClaude<T>(
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

        const result = await this.claudeCliClient.callJson({
          ...options,
          signal,
        });
        return { success: true, data: parseJsonContent<T>(result.text, jobId) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (attempt < maxRetries && shouldRetryAttempt({ message })) {
          logger.warn("Claude CLI attempt failed, retrying", {
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
