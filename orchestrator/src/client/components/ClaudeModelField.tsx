import { SettingsInput } from "@client/pages/settings/components/SettingsInput";
import type React from "react";

/** Aliases the Claude Code CLI accepts; ":medium"/":high" set the effort. */
export const CLAUDE_MODEL_SUGGESTIONS = [
  "opus:medium",
  "opus:high",
  "opus",
  "sonnet",
  "haiku",
];

type ClaudeModelFieldProps = {
  value: string;
  onChange: (value: string) => void;
  effectiveModel?: string | null;
  defaultModel?: string | null;
  disabled?: boolean;
  error?: string;
  /** Connection check shown under the field (setup screen). */
  validationSlot?: React.ReactNode;
};

/**
 * Every AI step (scoring, tailoring, cover letters, agents) runs on Claude
 * through the Claude Code CLI with the user's subscription, so the only
 * choice left is the model.
 */
export const ClaudeModelField: React.FC<ClaudeModelFieldProps> = ({
  value,
  onChange,
  effectiveModel,
  defaultModel,
  disabled,
  error,
  validationSlot,
}) => (
  <div className="space-y-4">
    <p className="text-sm text-muted-foreground">
      Boussole runs every AI step on Claude through the Claude Code CLI, with
      your Claude subscription: no API key. Sign in once by running{" "}
      <code className="rounded bg-muted px-1 py-0.5 text-xs">claude</code> in a
      terminal (on a server,{" "}
      <code className="rounded bg-muted px-1 py-0.5 text-xs">
        claude setup-token
      </code>
      ).
    </p>
    <SettingsInput
      label="Claude model"
      inputProps={{
        id: "claude-model",
        name: "model",
        list: "claude-model-suggestions",
        value,
        onChange: (event) => onChange(event.currentTarget.value),
        autoComplete: "off",
      }}
      placeholder={defaultModel || "opus:medium"}
      disabled={disabled}
      error={error}
      current={effectiveModel ? `In use: ${effectiveModel}` : undefined}
      helper={
        <>
          A model alias with an optional effort, for example{" "}
          <code>opus:medium</code>. Leave empty for the default
          {defaultModel ? ` (${defaultModel})` : ""}.
        </>
      }
    />
    <datalist id="claude-model-suggestions">
      {CLAUDE_MODEL_SUGGESTIONS.map((model) => (
        <option key={model} value={model} />
      ))}
    </datalist>
    {validationSlot}
  </div>
);
