import * as api from "@client/api";
import { queryKeys } from "@client/lib/queryKeys";
import type {
  AiAccountStatus,
  AiSignInSession,
  AiSignInState,
} from "@shared/types";
import { useQuery } from "@tanstack/react-query";

/** How often the overview is re-read while a sign-in is in progress. */
export const AI_SIGN_IN_POLL_MS = 2_000;

const ACTIVE_SIGN_IN_STATES: ReadonlySet<AiSignInState> = new Set([
  "starting",
  "waiting_for_code",
  "waiting_for_approval",
  "completing",
]);

export function isAiSignInStateActive(
  state: AiSignInState | null | undefined,
): boolean {
  return state ? ACTIVE_SIGN_IN_STATES.has(state) : false;
}

export function isAiSignInActive(
  signIn: AiSignInSession | null | undefined,
): boolean {
  return isAiSignInStateActive(signIn?.state);
}

/** Signed in (personally or through the server's login) and installed. */
export function isAiAccountUsable(
  status: AiAccountStatus | null | undefined,
): boolean {
  return Boolean(status?.available && status.signedIn);
}

/**
 * The workspace's AI accounts. `poll` re-reads every 2 s while a sign-in is
 * in progress, so the panel follows the provider's sign-in page.
 */
export function useAiAccountOverview(options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.aiAccount.overview(),
    queryFn: () => api.getAiAccountOverview(),
    refetchInterval: options.poll
      ? (query) =>
          isAiSignInActive(query.state.data?.signIn)
            ? AI_SIGN_IN_POLL_MS
            : false
      : false,
  });
}
