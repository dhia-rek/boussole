/**
 * Where each workspace's AI sign-ins live: one private folder per workspace
 * and provider under DATA_DIR/ai-accounts. The provider CLIs keep their own
 * credentials there (CLAUDE_CONFIG_DIR / CODEX_HOME); Boussole only writes a
 * small marker saying who signed in and when.
 */
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDataDir } from "@server/config/dataDir";
import { DEFAULT_TENANT_ID } from "@server/tenancy/constants";
import type { AiProvider } from "@shared/types";

const MARKER_FILE = "boussole-account.json";

export type AiAccountMarker = {
  provider: AiProvider;
  signedInAt: string;
  accountLabel: string | null;
  planLabel: string | null;
};

export function aiAccountsRoot(): string {
  return join(getDataDir(), "ai-accounts");
}

/** Folder-safe workspace id; ids that need escaping get a stable hash. */
function workspaceSegment(tenantId: string): string {
  if (/^[A-Za-z0-9_-]{1,100}$/.test(tenantId)) return tenantId;
  return `w_${createHash("sha256").update(tenantId).digest("hex").slice(0, 32)}`;
}

export function aiAccountDir(tenantId: string, provider: AiProvider): string {
  return join(
    aiAccountsRoot(),
    workspaceSegment(tenantId),
    provider === "claude" ? "claude" : "codex",
  );
}

/** Creates the workspace's provider folder, readable by the server user only. */
export async function ensureAiAccountDir(
  tenantId: string,
  provider: AiProvider,
): Promise<string> {
  const workspaceDir = join(aiAccountsRoot(), workspaceSegment(tenantId));
  const dir = aiAccountDir(tenantId, provider);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(workspaceDir, 0o700).catch(() => undefined);
  await chmod(dir, 0o700).catch(() => undefined);
  return dir;
}

export async function readAiAccountMarker(
  tenantId: string,
  provider: AiProvider,
): Promise<AiAccountMarker | null> {
  try {
    const raw = await readFile(
      join(aiAccountDir(tenantId, provider), MARKER_FILE),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<AiAccountMarker>;
    if (parsed.provider !== provider || typeof parsed.signedInAt !== "string") {
      return null;
    }
    return {
      provider,
      signedInAt: parsed.signedInAt,
      accountLabel: parsed.accountLabel ?? null,
      planLabel: parsed.planLabel ?? null,
    };
  } catch {
    return null;
  }
}

export async function writeAiAccountMarker(
  tenantId: string,
  marker: AiAccountMarker,
): Promise<void> {
  const dir = await ensureAiAccountDir(tenantId, marker.provider);
  await writeFile(join(dir, MARKER_FILE), JSON.stringify(marker, null, 2), {
    mode: 0o600,
  });
}

/** Forgets a sign-in entirely: marker and the CLI's stored credentials. */
export async function removeAiAccount(
  tenantId: string,
  provider: AiProvider,
): Promise<void> {
  await rm(aiAccountDir(tenantId, provider), { recursive: true, force: true });
}

/** The owner's workspace may keep using the server's own Claude login. */
export function isOwnerWorkspace(tenantId: string): boolean {
  return tenantId === DEFAULT_TENANT_ID;
}
