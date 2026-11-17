import { getEffectiveSettings } from "@server/services/settings";
import { DEFAULT_CLAUDE_CLI_MODEL } from "@shared/settings-registry";

/**
 * The Claude model every AI task uses: Settings → AI model, else MODEL, else
 * "opus:medium" (alias plus reasoning effort, as the Claude Code CLI takes it).
 */
export async function resolveLlmModel(): Promise<string> {
  const settings = await getEffectiveSettings();
  const configured =
    typeof settings?.model?.value === "string"
      ? settings.model.value.trim()
      : "";
  return configured || DEFAULT_CLAUDE_CLI_MODEL;
}
