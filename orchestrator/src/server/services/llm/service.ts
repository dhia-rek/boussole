import { logger } from "@infra/logger";
import { getOriginalEnvValue } from "@server/services/envSettings";
import { toStringOrNull } from "@shared/utils/type-conversion";
import {
  computeLlmCacheKey,
  getCachedLlmResponse,
  setCachedLlmResponse,
} from "./cache";
import { ClaudeCliClient } from "./claude-cli/client";
import { CodexClient } from "./codex/client";
import { GeminiCliClient } from "./gemini-cli/client";
import {
  buildModeCacheKey,
  getOrderedModes,
  rememberSuccessfulMode,
} from "./policies/mode-selection";
import {
  getRetryDelayMs,
  MAX_RATE_LIMIT_RETRIES,
  MAX_RATE_LIMIT_WAIT_MS,
  parseRateLimitDelayMs,
  shouldRetryAttempt,
} from "./policies/retry-policy";
import { strategies } from "./providers";
import type {
  JsonSchemaDefinition,
  LlmApiError,
  LlmProvider,
  LlmRequestOptions,
  LlmResponse,
  LlmServiceOptions,
  LlmValidationResult,
  ResponseMode,
} from "./types";
import {
  addQueryParam,
  buildHeaders,
  getResponseDetail,
  joinUrl,
} from "./utils/http";
import { parseJsonContent } from "./utils/json";
import { parseErrorMessage, truncate } from "./utils/string";

export class LlmService {
  private readonly provider: LlmProvider;
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly strategy: (typeof strategies)[LlmProvider];
  private readonly codexClient: CodexClient;
  private readonly geminiCliClient: GeminiCliClient;
  private readonly claudeCliClient: ClaudeCliClient;

  constructor(options: LlmServiceOptions = {}) {
    const normalizedBaseUrl =
      toStringOrNull(options.baseUrl) ||
      toStringOrNull(getOriginalEnvValue("LLM_BASE_URL")) ||
      null;
    const resolvedProvider = normalizeProvider(
      options.provider ?? getOriginalEnvValue("LLM_PROVIDER") ?? null,
    );

    const strategy = strategies[resolvedProvider];
    const baseUrl = normalizedBaseUrl || strategy.defaultBaseUrl;

    let apiKey =
      toStringOrNull(options.apiKey) ||
      toStringOrNull(getOriginalEnvValue("LLM_API_KEY")) ||
      null;

    // Backwards-compat migration: OPENROUTER_API_KEY -> LLM_API_KEY.
    // This prevents users from losing access when upgrading (keys are often only shown once).
    if (
      !apiKey &&
      resolvedProvider === "openrouter" &&
      toStringOrNull(getOriginalEnvValue("OPENROUTER_API_KEY"))
    ) {
      logger.warn(
        "[DEPRECATED] OPENROUTER_API_KEY is deprecated. Copying to LLM_API_KEY; please update your environment.",
      );
      const migrated = toStringOrNull(
        getOriginalEnvValue("OPENROUTER_API_KEY"),
      );
      if (migrated) {
        apiKey = migrated;
      }
    }

    this.provider = resolvedProvider;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.strategy = strategy;
    this.codexClient = new CodexClient();
    this.geminiCliClient = new GeminiCliClient();
    this.claudeCliClient = new ClaudeCliClient();
  }

  async callJson<T>(options: LlmRequestOptions<T>): Promise<LlmResponse<T>> {
    const cacheKey = computeLlmCacheKey({
      provider: this.provider,
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

    const result = await this.callJsonUncached(options);
    if (result.success) {
      setCachedLlmResponse(cacheKey, JSON.stringify(result.data));
    }
    return result;
  }

  private async callJsonUncached<T>(
    options: LlmRequestOptions<T>,
  ): Promise<LlmResponse<T>> {
    if (this.provider === "codex") {
      return this.callCodexJson(options);
    }

    if (this.provider === "gemini_cli") {
      return this.callGeminiCliJson(options);
    }

    if (this.provider === "claude_cli") {
      return this.callClaudeCliJson(options);
    }

    if (this.strategy.requiresApiKey && !this.apiKey) {
      return { success: false, error: "LLM API key not configured" };
    }

    const {
      model,
      messages,
      jsonSchema,
      maxRetries = 0,
      retryDelayMs = 500,
      signal,
    } = options;
    const jobId = options.jobId;

    const cacheKey = buildModeCacheKey(this.provider, this.baseUrl);
    const modes = getOrderedModes(cacheKey, this.strategy.modes);

    for (const mode of modes) {
      const result = await this.tryMode<T>({
        mode,
        model,
        messages,
        jsonSchema,
        maxRetries,
        retryDelayMs,
        jobId,
        signal,
      });

      if (result.success) {
        rememberSuccessfulMode(cacheKey, mode);
        return result;
      }

      if (!result.success && result.error.startsWith("CAPABILITY:")) {
        continue;
      }

      return result;
    }

    return { success: false, error: "All provider modes failed" };
  }

  getProvider(): LlmProvider {
    return this.provider;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async validateCredentials(): Promise<LlmValidationResult> {
    if (this.provider === "codex") {
      return this.codexClient.validateCredentials();
    }

    if (this.provider === "gemini_cli") {
      return this.geminiCliClient.validateCredentials();
    }

    if (this.provider === "claude_cli") {
      return this.claudeCliClient.validateCredentials();
    }

    if (this.strategy.requiresApiKey && !this.apiKey) {
      return { valid: false, message: "LLM API key is missing." };
    }

    const urls = this.strategy.getValidationUrls({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
    });
    let lastMessage: string | null = null;

    for (const url of urls) {
      try {
        const validationApiKey =
          this.provider === "gemini" ? null : this.apiKey;
        const response = await fetch(url, {
          method: "GET",
          headers: buildHeaders({
            apiKey: validationApiKey,
            provider: this.provider,
          }),
        });

        if (response.ok) {
          return { valid: true, message: null };
        }

        const detail = await getResponseDetail(response);
        if (response.status === 401 || response.status === 403) {
          return {
            valid: false,
            message: "Invalid LLM API key. Check the key and try again.",
          };
        }
        logger.warn("LLM credential validation request failed", {
          provider: this.provider,
          status: response.status,
          detail: detail || null,
        });

        lastMessage = detail || `LLM provider returned ${response.status}`;
      } catch (error) {
        logger.warn("LLM credential validation request errored", {
          provider: this.provider,
          error: error instanceof Error ? error.message : String(error),
        });
        lastMessage =
          error instanceof Error ? error.message : "LLM validation failed.";
      }
    }

    return {
      valid: false,
      message: lastMessage || "LLM provider validation failed.",
    };
  }

  async listModels(): Promise<string[]> {
    if (this.provider === "codex") {
      return this.codexClient.listModels();
    }

    if (this.provider === "gemini_cli") {
      const models = await this.geminiCliClient.listModels();
      return sortModels(models, getPreferredModel(this.provider));
    }

    if (this.provider === "claude_cli") {
      const models = await this.claudeCliClient.listModels();
      return sortModels(models, getPreferredModel(this.provider));
    }

    if (this.strategy.requiresApiKey && !this.apiKey) {
      throw new Error("LLM API key is missing.");
    }

    if (this.provider !== "openai" && this.provider !== "gemini") {
      return [];
    }

    const models =
      this.provider === "openai"
        ? await this.listOpenAiModels()
        : await this.listGeminiModels();

    return sortModels(models, getPreferredModel(this.provider));
  }

  private async callCodexJson<T>(
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

        const result = await this.codexClient.callJson({
          ...options,
          signal,
        });
        const parsed = parseJsonContent<T>(result.text, jobId);
        return { success: true, data: parsed };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (attempt < maxRetries && shouldRetryAttempt({ message })) {
          logger.warn("Codex attempt failed, retrying", {
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

  private async callGeminiCliJson<T>(
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

        const result = await this.geminiCliClient.callJson({
          ...options,
          signal,
        });
        const parsed = parseJsonContent<T>(result.text, jobId);
        return { success: true, data: parsed };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (attempt < maxRetries && shouldRetryAttempt({ message })) {
          logger.warn("Gemini CLI attempt failed, retrying", {
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

  private async callClaudeCliJson<T>(
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
        const parsed = parseJsonContent<T>(result.text, jobId);
        return { success: true, data: parsed };
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

  private async tryMode<T>(args: {
    mode: ResponseMode;
    model: string;
    messages: LlmRequestOptions<T>["messages"];
    jsonSchema: JsonSchemaDefinition;
    maxRetries: number;
    retryDelayMs: number;
    jobId?: string;
    signal?: AbortSignal;
  }): Promise<LlmResponse<T>> {
    const {
      mode,
      model: rawModel,
      messages,
      jsonSchema,
      maxRetries,
      retryDelayMs,
      signal,
    } = args;
    const jobId = args.jobId;
    const model = normalizeModelForProvider(this.provider, rawModel);

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

        const { url, headers, body } = this.strategy.buildRequest({
          mode,
          baseUrl: this.baseUrl,
          apiKey: this.apiKey,
          model,
          messages,
          jsonSchema,
        });

        const response = await fetchWithRateLimitRetries({
          url,
          init: {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal,
          },
          jobId,
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "No error body");
          const parsedError = parseErrorMessage(errorBody);
          const detail = parsedError ? ` - ${truncate(parsedError, 400)}` : "";
          const err = new Error(
            `LLM API error: ${response.status}${detail}`,
          ) as LlmApiError;
          err.status = response.status;
          err.body = truncate(errorBody, 600);
          throw err;
        }

        const data = await response.json();
        const content = this.strategy.extractText(data);

        if (!content) {
          throw new Error("No content in response");
        }

        const parsed = parseJsonContent<T>(content, jobId);
        return { success: true, data: parsed };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = (error as LlmApiError).status;
        const body = (error as LlmApiError).body;

        if (
          this.strategy.isCapabilityError({
            mode,
            status,
            body,
          })
        ) {
          return { success: false, error: `CAPABILITY:${message}` };
        }

        if (attempt < maxRetries && shouldRetryAttempt({ message, status })) {
          logger.warn("LLM attempt failed, retrying", {
            jobId: jobId ?? "unknown",
            attempt: attempt + 1,
            maxRetries,
            status: status ?? "no-status",
            message,
          });
          continue;
        }

        return { success: false, error: message };
      }
    }

    return { success: false, error: "All retry attempts failed" };
  }

  private async listOpenAiModels(): Promise<string[]> {
    const response = await fetch(joinUrl(this.baseUrl, "/v1/models"), {
      method: "GET",
      headers: buildHeaders({
        apiKey: this.apiKey,
        provider: this.provider,
      }),
    });

    if (!response.ok) {
      const detail = await getResponseDetail(response);
      throw new Error(detail || `OpenAI returned ${response.status}.`);
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: string | null }>;
    };
    return (payload.data ?? [])
      .map((entry) => entry.id?.trim() ?? "")
      .filter(isOpenAiTextGenerationModel)
      .filter(Boolean);
  }

  private async listGeminiModels(): Promise<string[]> {
    const url = addQueryParam(
      joinUrl(this.baseUrl, "/v1beta/models"),
      "key",
      this.apiKey ?? "",
    );
    const response = await fetch(url, {
      method: "GET",
      headers: buildHeaders({
        apiKey: null,
        provider: this.provider,
      }),
    });

    if (!response.ok) {
      const detail = await getResponseDetail(response);
      throw new Error(detail || `Gemini returned ${response.status}.`);
    }

    const payload = (await response.json()) as {
      models?: Array<{
        name?: string | null;
        supportedGenerationMethods?: string[] | null;
      }>;
    };
    return (payload.models ?? [])
      .filter((entry) =>
        entry.supportedGenerationMethods?.includes("generateContent"),
      )
      .map((entry) => {
        const normalized = normalizeGeminiModelName(entry.name ?? "");
        return normalized ? `google/${normalized}` : "";
      })
      .filter(isGeminiTextGenerationModel)
      .filter(Boolean);
  }
}

function normalizeProvider(raw: string | null): LlmProvider {
  const normalized = raw?.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "openai_compatible") return "openai_compatible";
  if (normalized === "openai") return "openai";
  if (normalized === "gemini") return "gemini";
  if (normalized === "gemini_cli") return "gemini_cli";
  if (normalized === "claude_cli") return "claude_cli";
  if (normalized === "codex") return "codex";
  if (normalized && normalized !== "openrouter") {
    logger.warn("Unknown LLM provider, defaulting to openrouter", {
      normalized,
    });
  }
  return "openrouter";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POSTs to the provider and, when it answers 429 with a short "retry after"
 * delay (free tiers often allow a few thousand tokens per minute), waits that
 * long and tries again instead of failing the whole job. Other responses are
 * returned untouched.
 */
async function fetchWithRateLimitRetries(args: {
  url: string;
  init: RequestInit;
  jobId?: string;
}): Promise<Response> {
  for (let retry = 0; ; retry++) {
    const response = await fetch(args.url, args.init);
    if (response.status !== 429 || retry >= MAX_RATE_LIMIT_RETRIES) {
      return response;
    }

    const body = await response.text().catch(() => "");
    const delayMs = parseRateLimitDelayMs({
      retryAfterHeader: response.headers?.get?.("retry-after") ?? null,
      body,
    });
    const waitMs = (delayMs ?? 2000 * (retry + 1)) + 250;
    if (waitMs > MAX_RATE_LIMIT_WAIT_MS || args.init.signal?.aborted) {
      // Hand the already-read body back to the caller's error handling.
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    logger.info("LLM provider rate limited, waiting before retry", {
      jobId: args.jobId ?? "unknown",
      waitMs,
      retry: retry + 1,
    });
    await sleep(waitMs);
  }
}

function normalizeModelForProvider(
  provider: LlmProvider,
  model: string,
): string {
  if (provider !== "gemini" && provider !== "gemini_cli") return model;
  return normalizeGeminiModelName(model) || model;
}

function normalizeGeminiModelName(value: string): string {
  return value
    .trim()
    .replace(/^models\//, "")
    .replace(/^google\//, "");
}

function getPreferredModel(provider: LlmProvider): string | null {
  if (provider === "openai") return "gpt-5.4-mini";
  if (provider === "gemini" || provider === "gemini_cli") {
    return "google/gemini-3-flash-preview";
  }
  return null;
}

function isOpenAiTextGenerationModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return false;

  const blockedPatterns = [
    "audio",
    "embedding",
    "image",
    "moderation",
    "realtime",
    "search",
    "similarity",
    "transcribe",
    "transcription",
    "tts",
    "vision",
    "whisper",
    "computer-use",
    "dall-e",
    "babbage",
    "davinci",
    "omni-moderation",
  ];
  if (blockedPatterns.some((pattern) => normalized.includes(pattern))) {
    return false;
  }

  return /^(gpt|o1|o3|o4|chatgpt|codex)/.test(normalized);
}

function isGeminiTextGenerationModel(model: string): boolean {
  const normalized = normalizeGeminiModelName(model).toLowerCase();
  if (!normalized) return false;
  if (!normalized.startsWith("gemini")) return false;

  const blockedPatterns = ["embedding", "aqa", "vision", "image", "tts"];
  return !blockedPatterns.some((pattern) => normalized.includes(pattern));
}

function sortModels(models: string[], preferredModel: string | null): string[] {
  const unique = Array.from(
    new Set(models.map((model) => model.trim())),
  ).filter(Boolean);
  unique.sort((left, right) => left.localeCompare(right));
  if (!preferredModel) return unique;

  const preferredIndex = unique.indexOf(preferredModel);
  if (preferredIndex <= 0) return unique;

  const [preferred] = unique.splice(preferredIndex, 1);
  return [preferred, ...unique];
}
