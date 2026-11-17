import { getActiveTenantId } from "@server/tenancy/context";
import type { AiAccountOverview } from "@shared/types";
import {
  resolveActiveAiProvider,
  resolveModelForProvider,
} from "../modelSelection";
import { CLAUDE_MODEL_OPTIONS, listChatgptModels } from "./models";
import { getAiSignInSnapshot } from "./sign-in";
import { getAiAccountStatus } from "./status";

/** Everything Settings → AI account shows for the active workspace. */
export async function getAiAccountOverview(
  options: { fresh?: boolean } = {},
): Promise<AiAccountOverview> {
  const tenantId = getActiveTenantId();
  const [
    activeProvider,
    claudeModel,
    chatgptModel,
    claude,
    chatgpt,
    chatgptModels,
  ] = await Promise.all([
    resolveActiveAiProvider(),
    resolveModelForProvider("claude"),
    resolveModelForProvider("chatgpt"),
    getAiAccountStatus(tenantId, "claude", options),
    getAiAccountStatus(tenantId, "chatgpt", options),
    listChatgptModels(),
  ]);
  return {
    activeProvider,
    accounts: { claude, chatgpt },
    models: { claude: CLAUDE_MODEL_OPTIONS, chatgpt: chatgptModels },
    selectedModels: { claude: claudeModel, chatgpt: chatgptModel },
    signIn: getAiSignInSnapshot(tenantId),
  };
}

export { AiAccountNotSignedInError } from "./runtime";
export {
  AiSignInError,
  cancelAiSignIn,
  startAiSignIn,
  submitAiSignInCode,
} from "./sign-in";
export { signOutAiAccount } from "./status";
