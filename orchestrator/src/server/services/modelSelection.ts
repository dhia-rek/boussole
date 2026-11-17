import * as settingsRepo from "@server/repositories/settings";
import { getOriginalEnvValue } from "@server/services/envSettings";
import { LlmService } from "@server/services/llm/service";
import { getEffectiveSettings } from "@server/services/settings";
import { getDefaultModelForProvider } from "@shared/settings-registry";

export type LlmModelPurpose =
  | "default"
  | "scoring"
  | "tailoring"
  | "projectSelection";

function readStringSettingValue(
  setting: { value?: unknown } | null | undefined,
): string | null {
  if (typeof setting?.value !== "string") {
    return null;
  }

  const trimmed = setting.value.trim();
  return trimmed || null;
}

function resolveDefaultModelFromSettings(
  settings: Awaited<ReturnType<typeof getEffectiveSettings>>,
): string {
  return (
    readStringSettingValue(settings?.model) ??
    getDefaultModelForProvider(
      readStringSettingValue(settings?.llmProvider) ??
        getOriginalEnvValue("LLM_PROVIDER"),
      getOriginalEnvValue("MODEL"),
    )
  );
}

export async function resolveLlmModel(
  purpose: LlmModelPurpose = "default",
): Promise<string> {
  const settings = await getEffectiveSettings();
  const defaultModel = resolveDefaultModelFromSettings(settings);

  if (purpose === "scoring") {
    return readStringSettingValue(settings?.modelScorer) ?? defaultModel;
  }

  if (purpose === "tailoring") {
    // When tailoring is routed to its own provider, use the raw modelTailoring
    // value. The effective-settings copy is normalized against the GLOBAL
    // provider and would drop a model name not valid there (e.g. a Groq model).
    const [tailoringProvider, rawTailoringModel] = await Promise.all([
      settingsRepo.getSetting("providerTailoring"),
      settingsRepo.getSetting("modelTailoring"),
    ]);
    if (tailoringProvider?.trim()) {
      return (
        rawTailoringModel?.trim() ||
        readStringSettingValue(settings?.modelTailoring) ||
        defaultModel
      );
    }
    return readStringSettingValue(settings?.modelTailoring) ?? defaultModel;
  }

  if (purpose === "projectSelection") {
    return (
      readStringSettingValue(settings?.modelProjectSelection) ?? defaultModel
    );
  }

  return defaultModel;
}

export async function resolveLlmRuntimeSettings(
  purpose: LlmModelPurpose = "default",
): Promise<{
  model: string;
  provider: string | null;
  baseUrl: string | null;
  apiKey: string | null;
}> {
  const getAllSettings =
    "getAllSettings" in settingsRepo ? settingsRepo.getAllSettings : null;
  const [settings, overrides] = await Promise.all([
    getEffectiveSettings(),
    typeof getAllSettings === "function"
      ? getAllSettings()
      : Promise.resolve({} as Partial<Record<settingsRepo.SettingKey, string>>),
  ]);
  const defaultModel = resolveDefaultModelFromSettings(settings);

  const model =
    purpose === "scoring"
      ? (readStringSettingValue(settings?.modelScorer) ?? defaultModel)
      : purpose === "tailoring"
        ? (readStringSettingValue(settings?.modelTailoring) ?? defaultModel)
        : purpose === "projectSelection"
          ? (readStringSettingValue(settings?.modelProjectSelection) ??
            defaultModel)
          : defaultModel;

  // Per-task provider override (multi-LLM routing). When providerTailoring is
  // set for the tailoring purpose, that task runs on its own provider + key,
  // independent of the global provider — so e.g. scoring on free Gemini and
  // tailoring on a separate free OpenRouter quota don't compete.
  // Read the per-task provider override straight from raw DB overrides — the
  // hand-built effective-settings object does not expose it.
  const tailoringProviderOverride =
    purpose === "tailoring"
      ? overrides?.providerTailoring?.trim() || null
      : null;

  if (tailoringProviderOverride) {
    // Use the raw modelTailoring value — `model` above is normalized against
    // the GLOBAL provider and would discard a model name (e.g. a Groq model)
    // that isn't valid for the global provider.
    const rawTailoringModel = overrides?.modelTailoring?.trim() || model;
    return {
      model: rawTailoringModel,
      provider: tailoringProviderOverride,
      baseUrl: overrides?.baseUrlTailoring?.trim() || null,
      apiKey:
        overrides?.apiKeyTailoring ||
        overrides?.llmApiKey ||
        getOriginalEnvValue("LLM_API_KEY") ||
        null,
    };
  }

  return {
    model,
    provider: readStringSettingValue(settings?.llmProvider),
    baseUrl: readStringSettingValue(settings?.llmBaseUrl),
    apiKey: overrides?.llmApiKey || getOriginalEnvValue("LLM_API_KEY") || null,
  };
}

export async function createConfiguredLlmService(
  purpose: LlmModelPurpose = "default",
): Promise<LlmService> {
  const runtime = await resolveLlmRuntimeSettings(purpose);
  return new LlmService({
    provider: runtime.provider,
    baseUrl: runtime.baseUrl,
    apiKey: runtime.apiKey,
  });
}
