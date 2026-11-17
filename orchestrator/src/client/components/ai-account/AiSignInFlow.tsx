import { showErrorToast } from "@client/lib/error-toast";
import { AI_PROVIDER_LABELS, type AiSignInSession } from "@shared/types";
import { AlertCircle, Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AiSignInFlowProps = {
  session: AiSignInSession;
  isSubmittingCode: boolean;
  isCancelling: boolean;
  isRestarting: boolean;
  /** Resolves true when the code was accepted for checking. */
  onSubmitCode: (code: string) => Promise<boolean>;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
};

/** The steps a person follows on the provider's own sign-in page. */
export const AiSignInFlow: React.FC<AiSignInFlowProps> = ({
  session,
  isSubmittingCode,
  isCancelling,
  isRestarting,
  onSubmitCode,
  onCancel,
  onRetry,
  onDismiss,
}) => {
  const label = AI_PROVIDER_LABELS[session.provider];

  if (session.state === "failed") {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>The sign-in did not finish</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{session.message ?? "Start the sign-in again."}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={onRetry}
              disabled={isRestarting}
            >
              {isRestarting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Try again
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
              Close
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const cancelButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onCancel}
      disabled={isCancelling}
    >
      Cancel
    </Button>
  );

  if (session.state === "waiting_for_code") {
    return (
      <FlowFrame title={`Sign in to ${label}`} footer={cancelButton}>
        <ol className="space-y-4">
          <FlowStep number={1} title="Open the Anthropic sign-in page.">
            <OpenSignInButton url={session.verificationUrl}>
              Open Anthropic sign-in
            </OpenSignInButton>
          </FlowStep>
          <FlowStep number={2} title="Sign in, then copy the code shown." />
          <FlowStep number={3} title="Paste it below, then select Finish.">
            <CodeEntry
              isSubmitting={isSubmittingCode}
              onSubmit={onSubmitCode}
            />
          </FlowStep>
        </ol>
      </FlowFrame>
    );
  }

  if (session.state === "waiting_for_approval") {
    return (
      <FlowFrame title={`Sign in to ${label}`} footer={cancelButton}>
        <ol className="space-y-4">
          <FlowStep number={1} title="Open the OpenAI sign-in page.">
            <OpenSignInButton url={session.verificationUrl}>
              Open OpenAI sign-in
            </OpenSignInButton>
          </FlowStep>
          <FlowStep number={2} title="Sign in and enter this code there.">
            <DeviceCode code={session.userCode} />
          </FlowStep>
          <FlowStep number={3} title="Approve the sign-in.">
            <BusyLine>Waiting for you to approve…</BusyLine>
          </FlowStep>
        </ol>
      </FlowFrame>
    );
  }

  // starting / completing
  return (
    <FlowFrame title={`Sign in to ${label}`} footer={cancelButton}>
      <BusyLine>
        {session.state === "starting"
          ? "Opening the sign-in page…"
          : "Checking your sign-in…"}
      </BusyLine>
    </FlowFrame>
  );
};

const FlowFrame: React.FC<{
  title: string;
  footer: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, footer, children }) => (
  <div className="space-y-4 rounded-lg border border-primary/30 bg-background/60 p-4">
    <div className="text-sm font-semibold">{title}</div>
    {children}
    <div className="flex justify-end">{footer}</div>
  </div>
);

const FlowStep: React.FC<{
  number: number;
  title: string;
  children?: React.ReactNode;
}> = ({ number, title, children }) => (
  <li className="flex gap-3">
    <span
      aria-hidden="true"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 text-xs font-medium"
    >
      {number}
    </span>
    <div className="min-w-0 flex-1 space-y-2 pt-0.5">
      <p className="text-sm">{title}</p>
      {children}
    </div>
  </li>
);

/** `<output>` is announced politely as a status by screen readers. */
const BusyLine: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <output className="flex items-center gap-2 text-sm text-muted-foreground">
    <Loader2 className="h-4 w-4 animate-spin" />
    {children}
  </output>
);

const OpenSignInButton: React.FC<{
  url: string | null;
  children: React.ReactNode;
}> = ({ url, children }) =>
  url ? (
    <Button asChild size="sm">
      <a href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="h-4 w-4" />
        {children}
      </a>
    </Button>
  ) : (
    <Button type="button" size="sm" disabled>
      <ExternalLink className="h-4 w-4" />
      {children}
    </Button>
  );

const CodeEntry: React.FC<{
  isSubmitting: boolean;
  onSubmit: (code: string) => Promise<boolean>;
}> = ({ isSubmitting, onSubmit }) => {
  const [code, setCode] = useState("");
  const canSubmit = code.trim().length > 0 && !isSubmitting;

  const submit = async () => {
    if (!canSubmit) return;
    if (await onSubmit(code.trim())) setCode("");
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input
        aria-label="Code from Anthropic"
        placeholder="Paste the code here"
        value={code}
        autoComplete="off"
        spellCheck={false}
        disabled={isSubmitting}
        onChange={(event) => setCode(event.currentTarget.value)}
        onKeyDown={(event) => {
          // The panel can sit inside another form (onboarding).
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <Button type="button" onClick={() => void submit()} disabled={!canSubmit}>
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Finish
      </Button>
    </div>
  );
};

const DeviceCode: React.FC<{ code: string | null }> = ({ code }) => {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  if (!code) {
    return <BusyLine>Getting your code…</BusyLine>;
  }

  const copy = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("Copying is not available here. Select the code instead.");
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => {
        setCopied(false);
        resetTimer.current = null;
      }, 2000);
    } catch (error) {
      showErrorToast(error, "Could not copy the code");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <code className="select-all whitespace-nowrap rounded-lg border border-border bg-background px-3 py-2 font-mono text-xl font-semibold tracking-[0.15em] sm:px-4 sm:text-2xl sm:tracking-[0.2em]">
        {code}
      </code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void copy()}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? "Copied" : "Copy code"}
      </Button>
    </div>
  );
};
