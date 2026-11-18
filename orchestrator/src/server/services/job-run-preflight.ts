/**
 * Shared checks before starting a per-job AI run (company research, CV check):
 * the active AI account and model, with a clear 422 when no account is signed
 * in for this workspace.
 */
import { unprocessableEntity } from "@infra/errors";
import type { AiProvider } from "@shared/types";
import {
  AiAccountNotSignedInError,
  assertAiAccountReady,
} from "./ai-accounts/runtime";
import {
  resolveActiveAiProvider,
  resolveModelForProvider,
} from "./modelSelection";

export async function resolveReadyAiAccount(): Promise<{
  provider: AiProvider;
  model: string | null;
}> {
  const provider = await resolveActiveAiProvider();
  try {
    await assertAiAccountReady(provider);
  } catch (error) {
    if (error instanceof AiAccountNotSignedInError) {
      throw unprocessableEntity(error.message);
    }
    throw error;
  }
  const model = (await resolveModelForProvider(provider)) || null;
  return { provider, model };
}
