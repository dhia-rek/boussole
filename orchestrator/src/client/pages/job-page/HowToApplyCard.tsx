import { type ApplyRoute, detectApplyRoutes } from "@shared/apply-route";
import type { Job } from "@shared/types.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileDown,
  Globe,
  Mail,
  PenLine,
  Send,
} from "lucide-react";
import React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import * as api from "@/client/api";
import { invalidateJobData } from "@/client/hooks/queries/invalidate";
import { showErrorToast } from "@/client/lib/error-toast";
import { openJobPdf } from "@/client/lib/private-pdf";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";

const APPLIED_STATUSES = new Set(["applied", "in_progress"]);

/** Rough language guess for the email subject line. */
function looksFrench(text: string | null | undefined): boolean {
  const sample = ` ${(text ?? "").slice(0, 3000).toLowerCase()} `;
  const french = (
    sample.match(/ (le|la|les|des|vous|nous|poste|et|une) /g) ?? []
  ).length;
  const english = (sample.match(/ (the|and|you|we|our|role|with|a) /g) ?? [])
    .length;
  return french > english;
}

export function buildMailto(route: ApplyRoute, job: Job): string {
  const subject = looksFrench(job.jobDescription)
    ? `Candidature : ${job.title}`
    : `Application: ${job.title}`;
  return `mailto:${route.email}?subject=${encodeURIComponent(subject)}`;
}

function routeTitle(route: ApplyRoute): string {
  switch (route.channel) {
    case "email":
      return `By email to ${route.email}`;
    case "linkedin":
      return `On ${route.label}`;
    case "company_ats":
      return `On the company's application site (${route.label})`;
    case "company_site":
      return "On the company website";
    default:
      return `On ${route.label}`;
  }
}

function RouteIcon({ route }: { route: ApplyRoute }) {
  const className = "mt-0.5 h-4 w-4 shrink-0 text-primary";
  if (route.channel === "email") return <Mail className={className} />;
  if (route.channel === "company_ats" || route.channel === "company_site") {
    return <Building2 className={className} />;
  }
  return <Globe className={className} />;
}

export const HowToApplyCard: React.FC<{ job: Job; baseJobPath: string }> = ({
  job,
  baseJobPath,
}) => {
  const queryClient = useQueryClient();
  const routes = React.useMemo(() => detectApplyRoutes(job), [job]);
  // Set when the person used an apply action; asks "Did you apply?".
  const [pending, setPending] = React.useState<ApplyRoute | null>(null);

  const markApplied = useMutation({
    mutationFn: (route: ApplyRoute) =>
      api.markAsApplied(job.id, {
        channel: route.channel === "email" ? "email" : route.label,
        ...(route.email ? { detail: `to ${route.email}` } : {}),
      }),
    onSuccess: async (_job, route) => {
      setPending(null);
      toast.success(
        route.channel === "email"
          ? `Logged: applied by email to ${route.email}`
          : `Logged: applied via ${route.label}`,
      );
      await invalidateJobData(queryClient, job.id);
    },
    onError: (error) => showErrorToast(error, "Could not mark as applied."),
  });

  const applied = APPLIED_STATUSES.has(job.status);
  const primary = routes.primary;

  return (
    <section
      className="rounded-xl border border-border/50 bg-card/75 p-4"
      aria-labelledby="how-to-apply-title"
    >
      <h2
        id="how-to-apply-title"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <Send className="h-4 w-4 text-primary" />
        How to apply
      </h2>

      {applied && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span>
            Applied
            {job.appliedAt ? ` on ${formatDateTime(job.appliedAt)}` : ""}.
          </span>
          <Link
            to={`${baseJobPath}/timeline`}
            className="text-primary underline-offset-2 hover:underline"
          >
            Open the timeline
          </Link>
        </p>
      )}

      {!primary && (
        <p className="mt-2 text-sm text-muted-foreground">
          The posting doesn't say how to apply. Open the job listing and look
          for an "Apply" button or a contact.
        </p>
      )}

      {primary && (
        <div className="mt-3 space-y-3">
          <div className="flex gap-2">
            <RouteIcon route={primary} />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium break-words">{routeTitle(primary)}</p>
              {primary.evidence && (
                <p className="text-xs text-muted-foreground">
                  The posting says:{" "}
                  <span className="italic">“{primary.evidence}”</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {primary.channel === "email" && primary.email ? (
              <>
                <Button size="sm" asChild>
                  <a
                    href={buildMailto(primary, job)}
                    onClick={() => setPending(primary)}
                  >
                    <Mail className="mr-1.5 h-3.5 w-3.5" />
                    Open in my mail app
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to={`${baseJobPath}/ghostwriter`}>
                    <PenLine className="mr-1.5 h-3.5 w-3.5" />
                    Write the email with Ghostwriter
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(primary.email ?? "")
                      .then(() => toast.success("Address copied"));
                  }}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Copy address
                </Button>
                {job.pdfPath && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void openJobPdf(job.id).catch((error) =>
                        showErrorToast(error, "Could not open the CV PDF"),
                      );
                    }}
                  >
                    <FileDown className="mr-1.5 h-3.5 w-3.5" />
                    CV to attach
                  </Button>
                )}
              </>
            ) : (
              primary.url && (
                <Button size="sm" asChild>
                  <a
                    href={primary.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setPending(primary)}
                  >
                    {primary.channel === "company_site"
                      ? "Apply on the company website"
                      : `Apply on ${primary.label}`}
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </a>
                </Button>
              )
            )}
            {!applied && !pending && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPending(primary)}
              >
                I already applied
              </Button>
            )}
          </div>

          {!applied && pending && (
            <output className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              <span className="min-w-0 flex-1">
                Did you apply
                {pending.channel === "email"
                  ? ` by email to ${pending.email}`
                  : ` via ${pending.label}`}
                ? Log it so Boussole tracks the follow-up.
              </span>
              <Button
                size="sm"
                onClick={() => markApplied.mutate(pending)}
                disabled={markApplied.isPending}
              >
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                Yes, mark applied
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPending(null)}
              >
                Not yet
              </Button>
            </output>
          )}

          {routes.alternatives.length > 0 && (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>Also mentioned in the posting:</p>
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {routes.alternatives.map((route) => (
                  <li key={`${route.channel}-${route.url ?? route.email}`}>
                    {route.url ? (
                      <a
                        href={route.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-foreground/80 underline-offset-2 hover:underline"
                        onClick={() => setPending(route)}
                      >
                        {route.label}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span>
                        {route.label}:{" "}
                        <a
                          href={`mailto:${route.email}`}
                          className="text-foreground/80 underline-offset-2 hover:underline"
                        >
                          {route.email}
                        </a>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
