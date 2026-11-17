import * as api from "@client/api";
import { showErrorToast } from "@client/lib/error-toast";
import { queryKeys } from "@client/lib/queryKeys";
import {
  AI_PROVIDER_LABELS,
  AI_PROVIDERS,
  type AiAccountOverview,
  type AiProvider,
  type AiSignInSession,
  type AiSignInState,
  type ClaudeSignInMode,
} from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { AiProviderCard } from "./AiProviderCard";
import {
  isAiAccountUsable,
  isAiSignInActive,
  isAiSignInStateActive,
  useAiAccountOverview,
} from "./useAiAccountOverview";

type AiAccountPanelProps = {
  /** Runs after a sign-in finishes, a sign-out, or a switch of account. */
  onAccountChange?: () => void;
};

type PendingKey =
  | `sign-in:${AiProvider}`
  | `sign-out:${AiProvider}`
  | `model:${AiProvider}`
  | "provider"
  | "code"
  | "cancel";

/**
 * Sign in with Claude or ChatGPT on the provider's own page, choose which
 * account Boussole uses, and pick each provider's model. Used in Settings and
 * in the first onboarding step.
 */
export const AiAccountPanel: React.FC<AiAccountPanelProps> = ({
  onAccountChange,
}) => {
  const queryClient = useQueryClient();
  const overviewQuery = useAiAccountOverview({ poll: true });
  const overview = overviewQuery.data;
  const signIn = overview?.signIn ?? null;

  const [pending, setPending] = useState<Partial<Record<PendingKey, boolean>>>(
    {},
  );
  const [isChoosingClaudeAccount, setIsChoosingClaudeAccount] = useState(false);
  const [dismissedSignInAt, setDismissedSignInAt] = useState<string | null>(
    null,
  );
  const [signOutDialog, setSignOutDialog] = useState<{
    open: boolean;
    provider: AiProvider;
  }>({ open: false, provider: "claude" });

  const onAccountChangeRef = useRef(onAccountChange);
  useEffect(() => {
    onAccountChangeRef.current = onAccountChange;
  }, [onAccountChange]);
  const notifyAccountChange = useCallback(() => {
    onAccountChangeRef.current?.();
  }, []);

  const runPending = useCallback(
    async <T,>(key: PendingKey, action: () => Promise<T>): Promise<T> => {
      setPending((current) => ({ ...current, [key]: true }));
      try {
        return await action();
      } finally {
        setPending((current) => ({ ...current, [key]: false }));
      }
    },
    [],
  );

  const updateOverview = useCallback(
    async (update: (current: AiAccountOverview) => AiAccountOverview) => {
      // Drop an in-flight poll so it cannot overwrite this newer state.
      await queryClient.cancelQueries({
        queryKey: queryKeys.aiAccount.overview(),
      });
      queryClient.setQueryData<AiAccountOverview>(
        queryKeys.aiAccount.overview(),
        (current) => (current ? update(current) : current),
      );
    },
    [queryClient],
  );

  const refreshOverview = useCallback(async () => {
    await queryClient.cancelQueries({
      queryKey: queryKeys.aiAccount.overview(),
    });
    const next = await api.getAiAccountOverview({ fresh: true });
    queryClient.setQueryData(queryKeys.aiAccount.overview(), next);
    return next;
  }, [queryClient]);

  /** These settings are saved here, outside the Settings form. */
  const markSettingsStale = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.settings.all,
      refetchType: "none",
    });
  }, [queryClient]);

  const chooseProvider = useCallback(
    (provider: AiProvider, options: { announce?: boolean } = {}) =>
      runPending("provider", async () => {
        const previous = queryClient.getQueryData<AiAccountOverview>(
          queryKeys.aiAccount.overview(),
        )?.activeProvider;
        await updateOverview((current) => ({
          ...current,
          activeProvider: provider,
        }));
        try {
          await api.updateSettings({ aiProvider: provider });
          markSettingsStale();
          if (options.announce !== false) {
            toast.success(`Boussole now uses ${AI_PROVIDER_LABELS[provider]}`);
          }
          return true;
        } catch (error) {
          if (previous) {
            await updateOverview((current) => ({
              ...current,
              activeProvider: previous,
            }));
          }
          showErrorToast(error, "Could not switch the AI account");
          return false;
        }
      }),
    [markSettingsStale, queryClient, runPending, updateOverview],
  );

  const saveModel = useCallback(
    async (provider: AiProvider, value: string) => {
      const previous =
        queryClient.getQueryData<AiAccountOverview>(
          queryKeys.aiAccount.overview(),
        )?.selectedModels[provider] ?? "";
      if (previous === value) return;
      const setSelected = (next: string) =>
        updateOverview((current) => ({
          ...current,
          selectedModels: { ...current.selectedModels, [provider]: next },
        }));
      await runPending(`model:${provider}`, async () => {
        await setSelected(value);
        try {
          await api.updateSettings(
            provider === "claude"
              ? { model: value || null }
              : { chatgptModel: value || null },
          );
          markSettingsStale();
          toast.success("Model saved");
        } catch (error) {
          await setSelected(previous);
          showErrorToast(error, "Could not save the model");
        }
      });
    },
    [markSettingsStale, queryClient, runPending, updateOverview],
  );

  const showSignIn = useCallback(
    (session: AiSignInSession | null) =>
      updateOverview((current) => ({ ...current, signIn: session })),
    [updateOverview],
  );

  const startSignIn = useCallback(
    async (provider: AiProvider, mode?: ClaudeSignInMode) => {
      setIsChoosingClaudeAccount(false);
      await runPending(`sign-in:${provider}`, async () => {
        try {
          const session = await api.startAiSignIn(
            provider === "claude"
              ? { provider, mode: mode ?? "subscription" }
              : { provider },
          );
          setDismissedSignInAt(null);
          await showSignIn(session);
        } catch (error) {
          showErrorToast(error, "Could not start the sign-in");
        }
      });
    },
    [runPending, showSignIn],
  );

  const submitCode = useCallback(
    (code: string) =>
      runPending("code", async () => {
        try {
          await showSignIn(await api.submitAiSignInCode(code));
          return true;
        } catch (error) {
          showErrorToast(error, "Could not check the code");
          void queryClient.invalidateQueries({
            queryKey: queryKeys.aiAccount.overview(),
          });
          return false;
        }
      }),
    [queryClient, runPending, showSignIn],
  );

  const cancelSignIn = useCallback(
    () =>
      runPending("cancel", async () => {
        try {
          await showSignIn(await api.cancelAiSignIn());
        } catch (error) {
          showErrorToast(error, "Could not cancel the sign-in");
        }
      }),
    [runPending, showSignIn],
  );

  const signOut = useCallback(
    (provider: AiProvider) =>
      runPending(`sign-out:${provider}`, async () => {
        try {
          await api.signOutAiAccount(provider);
        } catch (error) {
          showErrorToast(error, "Could not sign out");
          return;
        }
        toast.success(`Signed out of ${AI_PROVIDER_LABELS[provider]}`);
        try {
          await refreshOverview();
        } catch {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.aiAccount.overview(),
          });
        }
        notifyAccountChange();
      }),
    [notifyAccountChange, queryClient, refreshOverview, runPending],
  );

  const handleSignInCompleted = useCallback(
    async (provider: AiProvider) => {
      let next: AiAccountOverview | undefined;
      try {
        next = await refreshOverview();
      } catch {
        next = queryClient.getQueryData<AiAccountOverview>(
          queryKeys.aiAccount.overview(),
        );
      }
      // Signed in with the other provider while the chosen one cannot run:
      // use the account that works.
      const switchToProvider =
        next !== undefined &&
        next.activeProvider !== provider &&
        !isAiAccountUsable(next.accounts[next.activeProvider]) &&
        isAiAccountUsable(next.accounts[provider]);
      const switched = switchToProvider
        ? await chooseProvider(provider, { announce: false })
        : false;
      if (switched) {
        toast.success("Signed in", {
          description: `Boussole now uses ${AI_PROVIDER_LABELS[provider]}.`,
        });
      } else {
        toast.success("Signed in");
      }
      notifyAccountChange();
    },
    [chooseProvider, notifyAccountChange, queryClient, refreshOverview],
  );

  // A sign-in this panel watched has just finished.
  const lastSignInRef = useRef<{
    startedAt: string;
    state: AiSignInState;
  } | null>(null);
  useEffect(() => {
    const previous = lastSignInRef.current;
    lastSignInRef.current = signIn
      ? { startedAt: signIn.startedAt, state: signIn.state }
      : null;
    if (
      signIn?.state === "completed" &&
      previous?.startedAt === signIn.startedAt &&
      isAiSignInStateActive(previous.state)
    ) {
      void handleSignInCompleted(signIn.provider);
    }
  }, [handleSignInCompleted, signIn]);

  if (overviewQuery.isPending) {
    return (
      <output className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking your AI accounts…
      </output>
    );
  }

  if (!overview) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Could not load your AI accounts</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>Check that Boussole is running, then try again.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void overviewQuery.refetch()}
            disabled={overviewQuery.isFetching}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const visibleSignIn =
    signIn &&
    signIn.state !== "completed" &&
    signIn.state !== "cancelled" &&
    signIn.startedAt !== dismissedSignInAt
      ? signIn
      : null;
  const runningSignInProvider = isAiSignInActive(signIn)
    ? (signIn?.provider ?? null)
    : null;
  const signOutLabel = AI_PROVIDER_LABELS[signOutDialog.provider];
  const signOutIsActive = overview.activeProvider === signOutDialog.provider;

  return (
    <div className="space-y-4">
      {AI_PROVIDERS.map((provider) => (
        <AiProviderCard
          key={provider}
          provider={provider}
          status={overview.accounts[provider]}
          isActive={overview.activeProvider === provider}
          models={overview.models[provider]}
          selectedModel={overview.selectedModels[provider]}
          signIn={visibleSignIn?.provider === provider ? visibleSignIn : null}
          otherSignInProvider={
            runningSignInProvider !== provider ? runningSignInProvider : null
          }
          isChoosingClaudeAccount={
            provider === "claude" && isChoosingClaudeAccount
          }
          pending={{
            signIn: Boolean(pending[`sign-in:${provider}`]),
            signOut: Boolean(pending[`sign-out:${provider}`]),
            use: Boolean(pending.provider),
            model: Boolean(pending[`model:${provider}`]),
            code: Boolean(pending.code),
            cancel: Boolean(pending.cancel),
          }}
          actions={{
            onSignIn: () => {
              if (provider === "claude") setIsChoosingClaudeAccount(true);
              else void startSignIn(provider);
            },
            onChooseClaudeAccount: (mode) => void startSignIn("claude", mode),
            onCloseClaudeAccountChoice: () => setIsChoosingClaudeAccount(false),
            onSignOut: () => setSignOutDialog({ open: true, provider }),
            onUse: () => {
              void chooseProvider(provider).then((saved) => {
                if (saved) notifyAccountChange();
              });
            },
            onModelChange: (value) => void saveModel(provider, value),
            onSubmitCode: submitCode,
            onCancelSignIn: () => void cancelSignIn(),
            onRetrySignIn: () => {
              if (visibleSignIn) setDismissedSignInAt(visibleSignIn.startedAt);
              // Claude: ask again which account, in case it was the wrong one.
              if (provider === "claude") setIsChoosingClaudeAccount(true);
              else void startSignIn(provider);
            },
            onDismissSignIn: () => {
              if (visibleSignIn) setDismissedSignInAt(visibleSignIn.startedAt);
            },
          }}
        />
      ))}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        You sign in on Anthropic's or OpenAI's own page. Boussole never sees
        your password, and your sign-in stays private to your workspace.
      </p>

      <AlertDialog
        open={signOutDialog.open}
        onOpenChange={(open) =>
          setSignOutDialog((current) => ({ ...current, open }))
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out of {signOutLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              {signOutIsActive
                ? "Boussole uses this account for scoring, CV tailoring and the agents. They stop working until you sign in again or switch accounts."
                : "You can sign in again at any time."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void signOut(signOutDialog.provider)}
            >
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
