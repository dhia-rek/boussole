import { TooltipWhenDisabled } from "@client/components/TooltipWhenDisabled";
import {
  AI_PROVIDER_LABELS,
  type AiAccountStatus,
  type AiModelOption,
  type AiProvider,
  type AiSignInSession,
  type ClaudeSignInMode,
} from "@shared/types";
import {
  Ban,
  Check,
  CheckCircle2,
  CircleDashed,
  Loader2,
  LogIn,
  LogOut,
  Server,
} from "lucide-react";
import type React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AiModelPicker } from "./AiModelPicker";
import { AiSignInFlow } from "./AiSignInFlow";
import { isAiAccountUsable } from "./useAiAccountOverview";

const PROVIDER_TAGLINES: Record<AiProvider, string> = {
  claude: "Uses your Claude plan or Anthropic Console account.",
  chatgpt: "Uses your ChatGPT plan.",
};

export type AiProviderCardPending = {
  signIn: boolean;
  signOut: boolean;
  use: boolean;
  model: boolean;
  code: boolean;
  cancel: boolean;
};

export type AiProviderCardActions = {
  onSignIn: () => void;
  onChooseClaudeAccount: (mode: ClaudeSignInMode) => void;
  onCloseClaudeAccountChoice: () => void;
  onSignOut: () => void;
  onUse: () => void;
  onModelChange: (value: string) => void;
  onSubmitCode: (code: string) => Promise<boolean>;
  onCancelSignIn: () => void;
  onRetrySignIn: () => void;
  onDismissSignIn: () => void;
};

type AiProviderCardProps = {
  provider: AiProvider;
  status: AiAccountStatus;
  isActive: boolean;
  models: AiModelOption[];
  selectedModel: string;
  /** This provider's sign-in, while it is in progress or just failed. */
  signIn: AiSignInSession | null;
  /** The other provider's sign-in that is running; one runs at a time. */
  otherSignInProvider: AiProvider | null;
  isChoosingClaudeAccount: boolean;
  pending: AiProviderCardPending;
  actions: AiProviderCardActions;
};

export const AiProviderCard: React.FC<AiProviderCardProps> = ({
  provider,
  status,
  isActive,
  models,
  selectedModel,
  signIn,
  otherSignInProvider,
  isChoosingClaudeAccount,
  pending,
  actions,
}) => {
  const label = AI_PROVIDER_LABELS[provider];
  const usesServerLogin = status.signedIn && status.usesServerLogin;
  const canSignIn = status.available && (!status.signedIn || usesServerLogin);
  const canSignOut = status.available && status.signedIn && !usesServerLogin;

  let body: React.ReactNode = null;
  if (signIn) {
    body = (
      <AiSignInFlow
        session={signIn}
        isSubmittingCode={pending.code}
        isCancelling={pending.cancel}
        isRestarting={pending.signIn}
        onSubmitCode={actions.onSubmitCode}
        onCancel={actions.onCancelSignIn}
        onRetry={actions.onRetrySignIn}
        onDismiss={actions.onDismissSignIn}
      />
    );
  } else if (isChoosingClaudeAccount) {
    body = (
      <ClaudeAccountChoice
        disabled={pending.signIn}
        onChoose={actions.onChooseClaudeAccount}
        onClose={actions.onCloseClaudeAccountChoice}
      />
    );
  } else if (canSignIn || canSignOut) {
    body = (
      <div className="flex flex-wrap gap-2">
        {canSignIn ? (
          <TooltipWhenDisabled
            reason={
              otherSignInProvider
                ? `Finish or cancel the ${AI_PROVIDER_LABELS[otherSignInProvider]} sign-in first.`
                : null
            }
          >
            <Button
              type="button"
              size="sm"
              variant={usesServerLogin ? "outline" : "default"}
              onClick={actions.onSignIn}
              disabled={pending.signIn || otherSignInProvider !== null}
            >
              {pending.signIn ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {pending.signIn
                ? "Starting…"
                : usesServerLogin
                  ? "Sign in with your own account"
                  : `Sign in with ${label}`}
            </Button>
          </TooltipWhenDisabled>
        ) : null}
        {canSignOut ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={actions.onSignOut}
            disabled={pending.signOut}
          >
            {pending.signOut ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="h-4 w-4" />
            )}
            Sign out
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <section
      aria-label={`${label} account`}
      className={cn(
        "space-y-4 rounded-xl border p-4 transition-colors",
        isActive
          ? "border-primary/50 bg-primary/[0.06]"
          : "border-border/70 bg-muted/10",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{label}</h3>
            {isActive ? (
              <Badge
                variant="outline"
                className="gap-1 border-primary/40 text-primary"
              >
                <Check className="h-3 w-3" />
                In use
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {PROVIDER_TAGLINES[provider]}
          </p>
        </div>
        {!isActive && isAiAccountUsable(status) ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={actions.onUse}
            disabled={pending.use}
          >
            {pending.use ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Use {label}
          </Button>
        ) : null}
      </div>

      <AccountStatusLine status={status} label={label} />

      {body}

      {status.available ? (
        <div className="border-t border-border/60 pt-4">
          <AiModelPicker
            provider={provider}
            options={models}
            value={selectedModel}
            disabled={pending.model}
            onChange={actions.onModelChange}
          />
        </div>
      ) : null}
    </section>
  );
};

const AccountStatusLine: React.FC<{
  status: AiAccountStatus;
  label: string;
}> = ({ status, label }) => {
  if (!status.available) {
    return (
      <StatusRow
        icon={<Ban className="h-4 w-4" />}
        title="Not installed on this server"
      />
    );
  }
  if (status.signedIn && status.usesServerLogin) {
    return (
      <StatusRow
        ok
        icon={<Server className="h-4 w-4" />}
        title={`Using the server's ${label} login`}
        detail={
          [status.accountLabel, status.planLabel].filter(Boolean).join(" · ") ||
          null
        }
      />
    );
  }
  if (status.signedIn) {
    return (
      <StatusRow
        ok
        icon={<CheckCircle2 className="h-4 w-4" />}
        title={
          status.accountLabel
            ? `Signed in as ${status.accountLabel}`
            : "Signed in"
        }
        detail={status.planLabel}
      />
    );
  }
  return (
    <StatusRow
      icon={<CircleDashed className="h-4 w-4" />}
      title="Not signed in"
      detail={status.message}
    />
  );
};

const StatusRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  detail?: string | null;
  ok?: boolean;
}> = ({ icon, title, detail, ok = false }) => (
  <div className="flex items-start gap-2 text-sm">
    <span
      className={cn(
        "mt-0.5 shrink-0",
        ok ? "text-emerald-500" : "text-muted-foreground",
      )}
    >
      {icon}
    </span>
    <div className="min-w-0">
      <p className="break-words font-medium">{title}</p>
      {detail ? (
        <p className="break-words text-xs text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  </div>
);

const CLAUDE_ACCOUNT_KINDS: Array<{
  mode: ClaudeSignInMode;
  title: string;
  description: string;
}> = [
  {
    mode: "subscription",
    title: "Claude Pro or Max plan",
    description: "Uses your Claude subscription. Most people pick this.",
  },
  {
    mode: "console",
    title: "Anthropic Console",
    description: "Pay-per-use billing through your Anthropic Console account.",
  },
];

const ClaudeAccountChoice: React.FC<{
  disabled: boolean;
  onChoose: (mode: ClaudeSignInMode) => void;
  onClose: () => void;
}> = ({ disabled, onChoose, onClose }) => (
  <div className="space-y-3 rounded-lg border border-border/70 bg-background/60 p-4">
    <p className="text-sm font-medium">Which Claude account do you use?</p>
    <div className="grid gap-2 sm:grid-cols-2">
      {CLAUDE_ACCOUNT_KINDS.map((kind) => (
        <button
          key={kind.mode}
          type="button"
          disabled={disabled}
          onClick={() => onChoose(kind.mode)}
          className="flex flex-col items-start gap-1 rounded-lg border border-border/70 bg-background px-3 py-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="text-sm font-medium">{kind.title}</span>
          <span className="text-xs text-muted-foreground">
            {kind.description}
          </span>
        </button>
      ))}
    </div>
    <div className="flex justify-end">
      <Button type="button" variant="ghost" size="sm" onClick={onClose}>
        Cancel
      </Button>
    </div>
  </div>
);
