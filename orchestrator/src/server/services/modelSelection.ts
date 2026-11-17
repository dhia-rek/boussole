import { getSetting } from "@server/repositories/settings";
import {
  DEFAULT_CLAUDE_CLI_MODEL,
  settingsRegistry,
} from "@shared/settings-registry";
import type { AiProvider } from "@shared/types";

/** The AI account that runs this workspace's AI work (Settings → AI account). */
export async function resolveActiveAiProvider(): Promise<AiProvider> {
  const stored = await getSetting("aiProvider");
  return (
    settingsRegistry.aiProvider.parse(stored ?? undefined) ??
    settingsRegistry.aiProvider.default()
  );
}

/**
 * The model the person picked for a provider. Claude: "<alias>[:<effort>]",
 * default "opus:medium" (or MODEL). ChatGPT: "<slug>[:<effort>]", where ""
 * lets Codex use its own default model.
 */
export async function resolveModelForProvider(
  provider: AiProvider,
): Promise<string> {
  if (provider === "chatgpt") {
    return (await getSetting("chatgptModel"))?.trim() ?? "";
  }
  const stored = (await getSetting("model"))?.trim();
  return stored || settingsRegistry.model.default() || DEFAULT_CLAUDE_CLI_MODEL;
}

/** The model every AI task uses, for the workspace's active AI account. */
export async function resolveLlmModel(): Promise<string> {
  return resolveModelForProvider(await resolveActiveAiProvider());
}
