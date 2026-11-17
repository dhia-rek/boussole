import type {
  AiAccountOverview,
  AiProvider,
  AiSignInSession,
  ClaudeSignInMode,
} from "@shared/types";
import { fetchApi, withQuery } from "./core";

/** Accounts, models and any sign-in in progress for this workspace. */
export async function getAiAccountOverview(options?: {
  /** Re-check the sign-in status instead of using the 30 s server cache. */
  fresh?: boolean;
}): Promise<AiAccountOverview> {
  return fetchApi<AiAccountOverview>(
    withQuery("/ai-account", { fresh: options?.fresh ? 1 : undefined }),
  );
}

/** Starts the provider's own sign-in. Claude `mode` defaults to "subscription". */
export async function startAiSignIn(input: {
  provider: AiProvider;
  mode?: ClaudeSignInMode;
}): Promise<AiSignInSession> {
  return fetchApi<AiSignInSession>("/ai-account/sign-in", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Claude only: the code Anthropic shows after the person signs in. */
export async function submitAiSignInCode(
  code: string,
): Promise<AiSignInSession> {
  return fetchApi<AiSignInSession>("/ai-account/sign-in/code", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function cancelAiSignIn(): Promise<AiSignInSession | null> {
  return fetchApi<AiSignInSession | null>("/ai-account/sign-in", {
    method: "DELETE",
  });
}

export async function signOutAiAccount(
  provider: AiProvider,
): Promise<{ signedOut: true }> {
  return fetchApi<{ signedOut: true }>("/ai-account/sign-out", {
    method: "POST",
    body: JSON.stringify({ provider }),
  });
}
