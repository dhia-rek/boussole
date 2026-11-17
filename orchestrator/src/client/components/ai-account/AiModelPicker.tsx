import {
  AI_PROVIDER_LABELS,
  type AiModelEffort,
  type AiModelOption,
  type AiProvider,
  formatAiModelChoice,
  parseAiModelChoice,
} from "@shared/types";
import type React from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Select value for "let the provider pick" (Radix items cannot use ""). */
const PROVIDER_DEFAULT_MODEL = "__provider-default__";

const EFFORT_LABELS: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
};

export function formatEffortLabel(effort: string): string {
  return (
    EFFORT_LABELS[effort.toLowerCase()] ??
    effort.charAt(0).toUpperCase() + effort.slice(1)
  );
}

/** Keeps a saved model selectable even when the list no longer offers it. */
function withSavedModel(
  options: AiModelOption[],
  model: string | null,
  effort: string | null,
): AiModelOption[] {
  if (!model || options.some((option) => option.id === model)) return options;
  return [
    ...options,
    {
      id: model,
      label: model,
      description: null,
      efforts: effort ? [{ id: effort, description: null }] : [],
      defaultEffort: effort,
    },
  ];
}

function effortsFor(
  option: AiModelOption | null,
  savedEffort: string | null,
): AiModelEffort[] {
  if (!option) return [];
  if (!savedEffort || option.efforts.some((e) => e.id === savedEffort)) {
    return option.efforts;
  }
  return [...option.efforts, { id: savedEffort, description: null }];
}

/** Effort to keep when the model changes: the current one if it still fits. */
function effortForModel(
  option: AiModelOption | undefined,
  current: string | null,
): string | null {
  if (!option || option.efforts.length === 0) return null;
  if (current && option.efforts.some((e) => e.id === current)) return current;
  return option.defaultEffort ?? option.efforts[0]?.id ?? null;
}

type AiModelPickerProps = {
  provider: AiProvider;
  options: AiModelOption[];
  /** Saved choice, "<model>" or "<model>:<effort>"; "" = provider default. */
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export const AiModelPicker: React.FC<AiModelPickerProps> = (props) =>
  props.options.length > 0 ? (
    <ModelSelects {...props} />
  ) : (
    <ModelTextField {...props} />
  );

const ModelSelects: React.FC<AiModelPickerProps> = ({
  provider,
  options,
  value,
  disabled,
  onChange,
}) => {
  const label = AI_PROVIDER_LABELS[provider];
  // Claude always resolves to a model; ChatGPT may leave it to its default.
  const offersProviderDefault = provider === "chatgpt";
  const saved = parseAiModelChoice(value);
  const allOptions = withSavedModel(options, saved.model, saved.effort);
  const selected =
    allOptions.find((option) => option.id === saved.model) ?? null;
  const efforts = effortsFor(selected, saved.effort);
  // No saved effort: show the one the provider uses by default.
  const selectedEffort =
    efforts.find((e) => e.id === saved.effort) ??
    efforts.find((e) => e.id === selected?.defaultEffort) ??
    efforts[0] ??
    null;
  const effort = selectedEffort?.id ?? null;
  const modelValue =
    selected?.id ?? (offersProviderDefault ? PROVIDER_DEFAULT_MODEL : "");

  const handleModelChange = (next: string) => {
    if (next === PROVIDER_DEFAULT_MODEL) {
      onChange("");
      return;
    }
    const option = allOptions.find((candidate) => candidate.id === next);
    onChange(formatAiModelChoice(next, effortForModel(option, effort)));
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <label htmlFor={`${provider}-model`} className="text-sm font-medium">
          Model
        </label>
        <Select
          value={modelValue}
          onValueChange={handleModelChange}
          disabled={disabled}
        >
          <SelectTrigger id={`${provider}-model`} aria-label={`${label} model`}>
            <SelectValue placeholder="Choose a model">
              {selected?.label ??
                (offersProviderDefault ? `${label}'s default` : undefined)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {offersProviderDefault ? (
              <SelectItem value={PROVIDER_DEFAULT_MODEL}>
                <OptionText
                  title={`${label}'s default`}
                  description={`Let ${label} pick its recommended model.`}
                />
              </SelectItem>
            ) : null}
            {allOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                <OptionText
                  title={option.label}
                  description={option.description}
                />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected?.description ? (
          <p className="text-xs text-muted-foreground">
            {selected.description}
          </p>
        ) : null}
      </div>

      {selected && efforts.length > 0 ? (
        <div className="space-y-2">
          <label htmlFor={`${provider}-effort`} className="text-sm font-medium">
            Effort
          </label>
          <Select
            value={effort ?? ""}
            onValueChange={(next) =>
              onChange(formatAiModelChoice(selected.id, next))
            }
            disabled={disabled}
          >
            <SelectTrigger
              id={`${provider}-effort`}
              aria-label={`${label} effort`}
            >
              <SelectValue placeholder="Choose an effort">
                {selectedEffort ? formatEffortLabel(selectedEffort.id) : null}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {efforts.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  <OptionText
                    title={formatEffortLabel(option.id)}
                    description={option.description}
                  />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            More effort gives more careful answers but takes longer.
          </p>
        </div>
      ) : null}
    </div>
  );
};

const OptionText: React.FC<{
  title: string;
  description: string | null;
}> = ({ title, description }) => (
  <span className="flex flex-col py-0.5">
    <span>{title}</span>
    {description ? (
      <span className="text-xs text-muted-foreground">{description}</span>
    ) : null}
  </span>
);

/** Free text when the server cannot list the provider's models. */
const ModelTextField: React.FC<AiModelPickerProps> = ({
  provider,
  value,
  disabled,
  onChange,
}) => {
  const label = AI_PROVIDER_LABELS[provider];
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const unchanged = draft.trim() === value.trim();
  const save = () => {
    if (!unchanged) onChange(draft.trim());
  };

  return (
    <div className="space-y-2">
      <label htmlFor={`${provider}-model`} className="text-sm font-medium">
        Model
      </label>
      <div className="flex gap-2">
        <Input
          id={`${provider}-model`}
          aria-label={`${label} model`}
          value={draft}
          maxLength={200}
          placeholder={`${label}'s default`}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            // The panel can sit inside another form (onboarding).
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={save}
          disabled={disabled || unchanged}
        >
          Save model
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Type the model name, and add :low, :medium or :high to set the effort.
        Leave it empty to use {label}'s default.
      </p>
    </div>
  );
};
