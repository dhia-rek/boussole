/**
 * Models each person can pick from. Claude: the Claude Code aliases, which
 * always point at the latest model of each family. ChatGPT: Codex's own model
 * catalog (`codex debug models`), which needs no sign-in.
 */
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "@infra/logger";
import type { AiModelEffort, AiModelOption } from "@shared/types";
import { runCli } from "./process";
import { codexCommand, personalCodexEnv } from "./runtime";

const CLAUDE_EFFORTS: AiModelEffort[] = [
  { id: "low", description: "Fastest answers" },
  { id: "medium", description: "Balanced (recommended)" },
  { id: "high", description: "Deeper reasoning" },
  { id: "xhigh", description: "Extra deep reasoning" },
  { id: "max", description: "Deepest reasoning, slowest" },
];

export const CLAUDE_MODEL_OPTIONS: AiModelOption[] = [
  {
    id: "opus",
    label: "Claude Opus",
    description: "Most capable. Best for CV tailoring and the agent team.",
    efforts: CLAUDE_EFFORTS,
    defaultEffort: "medium",
  },
  {
    id: "sonnet",
    label: "Claude Sonnet",
    description: "Fast and capable for everyday work.",
    efforts: CLAUDE_EFFORTS,
    defaultEffort: "medium",
  },
  {
    id: "haiku",
    label: "Claude Haiku",
    description: "Fastest and lightest.",
    efforts: CLAUDE_EFFORTS,
    defaultEffort: "medium",
  },
];

const CATALOG_TTL_MS = 60 * 60_000;
let codexCatalog: { at: number; value: AiModelOption[] } | null = null;

type CatalogEntry = {
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  visibility?: unknown;
  priority?: unknown;
  default_reasoning_level?: unknown;
  supported_reasoning_levels?: unknown;
};

export function parseCodexCatalog(raw: string): AiModelOption[] {
  const parsed = JSON.parse(raw) as
    | { models?: CatalogEntry[] }
    | CatalogEntry[];
  const entries = Array.isArray(parsed) ? parsed : (parsed.models ?? []);
  return entries
    .filter(
      (entry) =>
        typeof entry.slug === "string" &&
        entry.slug.length > 0 &&
        entry.visibility === "list",
    )
    .sort(
      (a, b) =>
        (typeof a.priority === "number" ? a.priority : 999) -
        (typeof b.priority === "number" ? b.priority : 999),
    )
    .map((entry) => {
      const levels = Array.isArray(entry.supported_reasoning_levels)
        ? (entry.supported_reasoning_levels as Array<{
            effort?: unknown;
            description?: unknown;
          }>)
        : [];
      return {
        id: entry.slug as string,
        label:
          typeof entry.display_name === "string"
            ? entry.display_name
            : (entry.slug as string),
        description:
          typeof entry.description === "string" ? entry.description : null,
        efforts: levels
          .filter((level) => typeof level.effort === "string")
          .map((level) => ({
            id: level.effort as string,
            description:
              typeof level.description === "string" ? level.description : null,
          })),
        defaultEffort:
          typeof entry.default_reasoning_level === "string"
            ? entry.default_reasoning_level
            : null,
      };
    });
}

/** Codex's model catalog; empty when the CLI is missing (the UI then takes free text). */
export async function listChatgptModels(): Promise<AiModelOption[]> {
  if (codexCatalog && Date.now() - codexCatalog.at < CATALOG_TTL_MS) {
    return codexCatalog.value;
  }
  try {
    const home = join(tmpdir(), "boussole-codex-catalog");
    await mkdir(home, { recursive: true });
    const { command, prefixArgs } = codexCommand();
    const result = await runCli(command, [...prefixArgs, "debug", "models"], {
      env: personalCodexEnv(home),
      timeoutMs: 20_000,
    });
    const value = result.code === 0 ? parseCodexCatalog(result.stdout) : [];
    codexCatalog = { at: Date.now(), value };
    return value;
  } catch (error) {
    logger.warn("Could not read the Codex model catalog", {
      error: error instanceof Error ? error.message : String(error),
    });
    codexCatalog = { at: Date.now(), value: [] };
    return [];
  }
}
