import * as api from "@client/api";
import { Loader2, Mail } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ICLOUD_ADDRESS = /@(icloud|me|mac)\.com$/i;

/**
 * Connects iCloud Mail (or any IMAP mailbox) with an app-specific password:
 * three steps to create one, two fields, and what Boussole does with mail.
 */
export const ImapConnectForm: React.FC<{
  accountKey: string;
  onConnected: () => Promise<void> | void;
}> = ({ accountKey, onConnected }) => {
  const [email, setEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("993");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedEmail = email.trim();
  // Other providers need their server; iCloud's is known.
  const needsServer =
    trimmedEmail.includes("@") && !ICLOUD_ADDRESS.test(trimmedEmail);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!trimmedEmail || !appPassword.trim()) {
      setError("Enter your email address and the app-specific password.");
      return;
    }
    if (needsServer && !host.trim()) {
      setError(
        "This isn't an iCloud address: enter your mail provider's IMAP server below.",
      );
      return;
    }
    setBusy(true);
    try {
      await api.postApplicationImapConnect({
        accountKey,
        email: trimmedEmail,
        appPassword,
        ...(needsServer
          ? { host: host.trim(), port: Number.parseInt(port, 10) || 993 }
          : {}),
      });
      setAppPassword("");
      toast.success("Mailbox connected. Click Sync to read your job emails.");
      await onConnected();
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Could not connect the mailbox.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-labelledby="imap-connect-title"
      onSubmit={(event) => void submit(event)}
      className="space-y-3 rounded-md border border-border/60 p-3 text-sm"
    >
      <p
        id="imap-connect-title"
        className="flex items-center gap-2 font-medium"
      >
        <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
        Connect iCloud Mail
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        <li>
          Open{" "}
          <a
            href="https://account.apple.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            account.apple.com
          </a>{" "}
          and sign in.
        </li>
        <li>
          In <span className="text-foreground">Sign-In and Security</span>, open{" "}
          <span className="text-foreground">App-Specific Passwords</span> and
          create one named "Boussole".
        </li>
        <li>Paste it below with your iCloud email address.</li>
      </ol>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="imap-email">Email address</Label>
          <Input
            id="imap-email"
            type="email"
            autoComplete="email"
            placeholder="you@icloud.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="imap-password">App-specific password</Label>
          <Input
            id="imap-password"
            type="password"
            autoComplete="off"
            placeholder="xxxx-xxxx-xxxx-xxxx"
            value={appPassword}
            onChange={(event) => setAppPassword(event.target.value)}
          />
        </div>
      </div>

      {needsServer ? (
        <div className="grid gap-3 md:grid-cols-[1fr_8rem]">
          <div className="space-y-1.5">
            <Label htmlFor="imap-host">IMAP server</Label>
            <Input
              id="imap-host"
              placeholder="imap.example.com"
              value={host}
              onChange={(event) => setHost(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="imap-port">Port</Label>
            <Input
              id="imap-port"
              inputMode="numeric"
              value={port}
              onChange={(event) => setPort(event.target.value)}
            />
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Boussole only reads your inbox: it never sends, moves or deletes email.
        The password stays on this Boussole and is deleted when you disconnect.
        Emails that look job-related are sent to your AI account to sort them.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy} className="gap-2">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {busy ? "Checking…" : "Connect"}
      </Button>
    </form>
  );
};
