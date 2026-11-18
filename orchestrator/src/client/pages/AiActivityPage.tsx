import { useQuery } from "@tanstack/react-query";
import { Bot, CheckCircle2, ChevronDown, Loader2, XCircle } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { AiActivityItem } from "@/client/api";
import * as api from "@/client/api";
import { useQueryErrorToast } from "@/client/hooks/useQueryErrorToast";
import { queryKeys } from "@/client/lib/queryKeys";
import { formatRelativeTime } from "@/client/lib/relative-time";
import { cn } from "@/lib/utils";
import { PageHeader, PageMain } from "../components/layout";

function providerName(provider: string): string {
  if (provider === "claude") return "Claude";
  if (provider === "codex") return "ChatGPT";
  return provider;
}

function durationText(ms: number | null): string | null {
  if (ms === null) return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** JSON answers are shown indented; anything else as is. */
function readable(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

const StatusIcon: React.FC<{ status: AiActivityItem["status"] }> = ({
  status,
}) => {
  if (status === "running") {
    return (
      <Loader2
        className="h-4 w-4 shrink-0 animate-spin text-primary"
        aria-label="running"
      />
    );
  }
  if (status === "error") {
    return (
      <XCircle
        className="h-4 w-4 shrink-0 text-destructive"
        aria-label="failed"
      />
    );
  }
  return (
    <CheckCircle2
      className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
      aria-label="done"
    />
  );
};

const Block: React.FC<{
  title: string;
  text: string;
  chars?: number | null;
}> = ({ title, text, chars }) => (
  <div className="min-w-0 space-y-1">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {title}
      {typeof chars === "number"
        ? ` · ${chars.toLocaleString()} characters`
        : ""}
    </p>
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/50 bg-muted/30 p-3 text-xs leading-5">
      {text}
    </pre>
  </div>
);

const ActivityRow: React.FC<{ item: AiActivityItem }> = ({ item }) => {
  const [open, setOpen] = useState(false);
  const duration = durationText(item.durationMs);
  return (
    <li className="rounded-xl border border-border/50 bg-card/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left"
      >
        <StatusIcon status={item.status} />
        <span className="font-medium">{item.label}</span>
        {item.jobTitle ? (
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            {item.jobTitle}
            {item.jobEmployer ? ` · ${item.jobEmployer}` : ""}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {providerName(item.provider)}
            {item.model ? ` · ${item.model}` : ""}
          </span>
          {item.status === "running" ? (
            <span>working…</span>
          ) : duration ? (
            <span className="tabular-nums">{duration}</span>
          ) : null}
          <span>{formatRelativeTime(item.startedAt)}</span>
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </span>
      </button>
      {open ? (
        <div className="grid gap-3 border-t border-border/40 p-4 lg:grid-cols-2">
          <Block
            title="What Boussole sent"
            text={item.promptPreview}
            chars={item.promptChars}
          />
          {item.status === "error" ? (
            <Block
              title="What went wrong"
              text={item.error ?? "Unknown error"}
            />
          ) : item.status === "running" ? (
            <Block title="What the AI answered" text="Still working…" />
          ) : (
            <Block
              title="What the AI answered"
              text={readable(item.responsePreview ?? "")}
              chars={item.responseChars}
            />
          )}
          {item.jobId ? (
            <Link
              to={`/job/${item.jobId}`}
              className="text-sm text-primary underline-offset-2 hover:underline"
            >
              Open the job
            </Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
};

/** Follow what the AI does: every request, what was sent and what came back. */
export const AiActivityPage: React.FC = () => {
  const [onlyErrors, setOnlyErrors] = useState(false);
  const activityQuery = useQuery({
    queryKey: queryKeys.aiActivity.list(),
    queryFn: () => api.getAiActivity(200),
    refetchInterval: (query) =>
      query.state.data?.some((item) => item.status === "running")
        ? 2_000
        : 10_000,
  });
  useQueryErrorToast(activityQuery.error, "Could not load the AI activity.");
  const items = activityQuery.data ?? [];
  const errors = items.filter((item) => item.status === "error").length;
  const running = items.filter((item) => item.status === "running").length;
  const shown = onlyErrors
    ? items.filter((item) => item.status === "error")
    : items;

  return (
    <>
      <PageHeader
        icon={Bot}
        title="AI activity"
        subtitle="What Boussole asks your AI, and what it answers"
      />
      <PageMain className="max-w-5xl space-y-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every request Boussole sends to your AI account: what it was for,
          which job, what was sent and what came back. Click a line to read it.
          Kept only on this Boussole (the last 300).
        </p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {running > 0 ? (
            <span className="flex items-center gap-1.5 text-primary">
              <Loader2 className="h-4 w-4 animate-spin" />
              {running} working now
            </span>
          ) : null}
          <span className="text-muted-foreground">
            {items.length} recent · {errors} failed
          </span>
          {errors > 0 ? (
            <label className="flex items-center gap-2 text-muted-foreground">
              <input
                type="checkbox"
                checked={onlyErrors}
                onChange={(event) => setOnlyErrors(event.target.checked)}
              />
              Only failed
            </label>
          ) : null}
        </div>
        {activityQuery.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
            Nothing yet. AI requests appear here as soon as Boussole sends one:
            scoring a job, writing with Ghostwriter, a CV check…
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </PageMain>
    </>
  );
};
