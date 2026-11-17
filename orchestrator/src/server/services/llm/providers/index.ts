import type { LlmProvider, ProviderStrategy } from "../types";
import { claudeCliStrategy } from "./claude_cli";
import { codexStrategy } from "./codex";
import { geminiStrategy } from "./gemini";
import { geminiCliStrategy } from "./gemini_cli";
import { openAiStrategy } from "./openai";
import { openAiCompatibleStrategy } from "./openai-compatible";
import { openRouterStrategy } from "./openrouter";

export const strategies: Record<LlmProvider, ProviderStrategy> = {
  openrouter: openRouterStrategy,
  openai: openAiStrategy,
  openai_compatible: openAiCompatibleStrategy,
  gemini: geminiStrategy,
  gemini_cli: geminiCliStrategy,
  claude_cli: claudeCliStrategy,
  codex: codexStrategy,
};
