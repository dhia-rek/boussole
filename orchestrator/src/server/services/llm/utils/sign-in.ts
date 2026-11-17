/**
 * True when an AI error means the account behind it is not signed in (or its
 * sign-in expired), as opposed to a one-off failure worth retrying.
 */
const SIGN_IN_PATTERNS = [
  /please run \/login/i,
  /invalid api key/i,
  /not (?:logged|signed) in/i,
  /oauth token (?:has )?expired/i,
  /authentication_error/i,
];

export function isAiSignInError(message: string | null | undefined): boolean {
  if (!message) return false;
  return SIGN_IN_PATTERNS.some((pattern) => pattern.test(message));
}
