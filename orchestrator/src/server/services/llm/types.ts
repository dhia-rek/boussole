/** All AI runs on Claude through the Claude Code CLI. */
export type LlmProvider = "claude_cli";

export interface JsonSchemaDefinition {
  name: string;
  schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
}

export type LlmContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      imageUrl: string;
      mediaType: "image/png" | "image/jpeg" | "image/webp";
      name?: string;
    };

export type LlmMessageContent = string | LlmContentPart[];

export interface LlmMessage {
  role: "user" | "system" | "assistant";
  content: LlmMessageContent;
}

export interface LlmRequestOptions<_T> {
  /** Claude model alias, optionally with effort (e.g. "opus:medium") */
  model: string;
  /** The prompt messages to send */
  messages: LlmMessage[];
  /** JSON schema for structured output */
  jsonSchema: JsonSchemaDefinition;
  /** Number of retries on parsing failures (default: 0) */
  maxRetries?: number;
  /** Delay between retries in ms (default: 500) */
  retryDelayMs?: number;
  /** Job ID for logging purposes */
  jobId?: string;
  /** Optional abort signal for cancellation */
  signal?: AbortSignal;
  /**
   * Skip the response cache (default false). Set for user-initiated
   * regenerations, which must produce a fresh answer for the same prompt.
   */
  bypassCache?: boolean;
}

export interface LlmResult<T> {
  success: true;
  data: T;
}

export interface LlmError {
  success: false;
  error: string;
}

export type LlmResponse<T> = LlmResult<T> | LlmError;

export type LlmValidationResult = {
  valid: boolean;
  message: string | null;
  username?: string | null;
};

export function getLlmMessageText(content: LlmMessageContent): string {
  if (typeof content === "string") return content;
  return content
    .map((part) =>
      part.type === "text"
        ? part.text
        : `[Attached image: ${part.name || part.mediaType}]`,
    )
    .join("\n");
}
