import { describe, expect, it } from "vitest";
import { isAiSignInError } from "./sign-in";

describe("isAiSignInError", () => {
  it.each([
    "Invalid API key · Please run /login",
    "Error: not logged in",
    "OAuth token has expired. Please obtain a new token.",
    '{"type":"error","error":{"type":"authentication_error"}}',
  ])("recognises %j", (message) => {
    expect(isAiSignInError(message)).toBe(true);
  });

  it.each([
    null,
    undefined,
    "",
    "Claude CLI exited with code 1.",
    "rate limited",
  ])("ignores %j", (message) => {
    expect(isAiSignInError(message)).toBe(false);
  });
});
