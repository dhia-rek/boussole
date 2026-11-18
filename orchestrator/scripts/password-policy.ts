/** Passwords that must never protect a Boussole reachable from the internet. */
export const EASY_PASSWORDS = [
  "admin",
  "password",
  "123456",
  "12345678",
  "123456789",
  "azerty",
  "qwerty",
  "letmein",
  "changeme",
  "secret",
  "boussole",
];

export const MIN_PASSWORD_LENGTH = 12;

/** Why a new password is too weak, or null when it is acceptable. */
export function passwordProblem(
  password: string,
  username: string,
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters (a short sentence works well).`;
  }
  const lower = password.toLowerCase();
  if (EASY_PASSWORDS.includes(lower)) return "That password is too common.";
  if (username && lower.includes(username.toLowerCase())) {
    return "Don't include your username in the password.";
  }
  return null;
}
