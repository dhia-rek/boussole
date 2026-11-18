import { isRecruitingContact } from "@shared/spontaneous";
import type {
  OutreachContact,
  SpontaneousOutreach,
  SpontaneousSuggestion,
} from "@shared/types.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CircleHelp,
  Copy,
  ExternalLink,
  FileDown,
  Globe,
  Loader2,
  Mail,
  PenLine,
  Search,
  Send,
  UserRound,
} from "lucide-react";
import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import * as api from "@/client/api";
import { useQueryErrorToast } from "@/client/hooks/useQueryErrorToast";
import { showErrorToast } from "@/client/lib/error-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { PageHeader, PageMain } from "../components";

const POLL_MS = 3000;
/** Longer mailto links get cut by some mail apps; the body is copied instead. */
const MAX_MAILTO_LENGTH = 1800;
const historyKey = ["spontaneous", "history"] as const;
const outreachKey = (id: string) => ["spontaneous", "outreach", id] as const;

function hostOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border/60 bg-card/40 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
            done
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
              : "bg-primary/15 text-primary",
          )}
        >
          {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function CheckLabel({ contact }: { contact: OutreachContact }) {
  if (contact.origin === "hunter") {
    return (
      <span className="text-xs text-muted-foreground">
        Hunter.io estimate
        {contact.confidence != null ? ` · ${contact.confidence}% sure` : ""} ·
        not checked
      </span>
    );
  }
  if (contact.check === "verified") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        {contact.kind === "email"
          ? `Found on ${hostOf(contact.sourceUrl)}`
          : "Page checked"}
      </span>
    );
  }
  if (contact.check === "not_checked") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CircleHelp className="h-3 w-3" />
        LinkedIn can't be checked automatically
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
      <AlertTriangle className="h-3 w-3" />
      Source page could not be read
    </span>
  );
}

function ContactIcon({ contact }: { contact: OutreachContact }) {
  const className = "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground";
  if (contact.kind === "email") return <Mail className={className} />;
  if (contact.kind === "linkedin_person") {
    return <UserRound className={className} />;
  }
  if (contact.kind === "application_form") {
    return <Building2 className={className} />;
  }
  return <Globe className={className} />;
}

const KIND_LABELS: Record<OutreachContact["kind"], string> = {
  email: "Email",
  application_form: "Application form",
  careers_page: "Careers page",
  linkedin_person: "On LinkedIn",
};

async function downloadCv(language: "fr" | "en") {
  const generated = await api.generateDesignResumePdf(language);
  const blob = await api.getDesignResumePdfBlob(generated.pdfUrl);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `CV-${language.toUpperCase()}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const SpontaneousPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const activeId = params.get("id");
  const [company, setCompany] = React.useState("");
  const [website, setWebsite] = React.useState("");

  const suggestionsQuery = useQuery({
    queryKey: ["spontaneous", "suggestions"],
    queryFn: api.getSpontaneousSuggestions,
  });
  const historyQuery = useQuery({
    queryKey: historyKey,
    queryFn: api.getSpontaneousHistory,
  });
  const outreachQuery = useQuery({
    queryKey: outreachKey(activeId ?? ""),
    queryFn: () => api.getSpontaneousOutreach(activeId ?? ""),
    enabled: Boolean(activeId),
    refetchInterval: (query) =>
      query.state.data?.status === "researching" ? POLL_MS : false,
  });
  useQueryErrorToast(outreachQuery.error, "Could not load this application.");

  const outreach = outreachQuery.data ?? null;
  const startMutation = useMutation({
    mutationFn: api.startSpontaneousOutreach,
    onSuccess: (created) => {
      queryClient.setQueryData(outreachKey(created.id), created);
      void queryClient.invalidateQueries({ queryKey: historyKey });
      setParams({ id: created.id });
    },
    onError: (error) => showErrorToast(error, "Could not start the search."),
  });

  const start = (input: { company: string; website?: string | null }) => {
    if (!input.company.trim()) return;
    startMutation.mutate(input);
  };

  return (
    <>
      <PageHeader
        icon={Send}
        title="Spontaneous applications"
        subtitle="Write to a company that hasn't posted the job you want"
      />
      <PageMain className="max-w-3xl space-y-4">
        <Step n={1} title="Pick a company" done={Boolean(outreach)}>
          <form
            className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              start({ company, website: website || null });
            }}
          >
            <Input
              aria-label="Company name"
              placeholder="Company, e.g. Qonto"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
            />
            <Input
              aria-label="Company website (optional)"
              placeholder="Website (optional)"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
            <Button
              type="submit"
              disabled={!company.trim() || startMutation.isPending}
            >
              {startMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="mr-1.5 h-3.5 w-3.5" />
              )}
              Find contacts
            </Button>
          </form>
          <Suggestions
            items={suggestionsQuery.data ?? []}
            onPick={(item) => {
              setCompany(item.company);
              setWebsite(item.website ?? "");
              start({ company: item.company, website: item.website });
            }}
          />
          <History
            items={historyQuery.data ?? []}
            activeId={activeId}
            onOpen={(id) => setParams({ id })}
          />
        </Step>

        {outreach && (
          <ContactsAndEmail
            key={outreach.id}
            outreach={outreach}
            onSearchAgain={() =>
              start({ company: outreach.company, website: outreach.website })
            }
          />
        )}
      </PageMain>
    </>
  );
};

function Suggestions({
  items,
  onPick,
}: {
  items: SpontaneousSuggestion[];
  onPick: (item: SpontaneousSuggestion) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Not sure where to start? Companies from your jobs that you haven't
        applied to yet:
      </p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item.company}
            type="button"
            onClick={() => onPick(item)}
            className="rounded-full border border-border/60 bg-background/40 px-3 py-1 text-xs hover:border-primary/60 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="font-medium">{item.company}</span>
            <span className="ml-1.5 text-muted-foreground">
              {item.jobCount} job{item.jobCount === 1 ? "" : "s"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function historyStatus(item: SpontaneousOutreach): string {
  if (item.jobId) return "Sent · on your board";
  if (item.status === "researching") return "Searching…";
  if (item.status === "failed") return "Search failed";
  if (item.email) return "Email written";
  return "Contacts found";
}

function History({
  items,
  activeId,
  onOpen,
}: {
  items: SpontaneousOutreach[];
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <details className="text-sm" open={!activeId}>
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Your spontaneous applications ({items.length})
      </summary>
      <ul className="mt-2 divide-y divide-border/40">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-1 py-2 text-left hover:bg-muted/40",
                item.id === activeId && "font-semibold",
              )}
            >
              <span className="truncate">{item.company}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {historyStatus(item)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ContactsAndEmail({
  outreach,
  onSearchAgain,
}: {
  outreach: SpontaneousOutreach;
  onSearchAgain: () => void;
}) {
  const queryClient = useQueryClient();
  // "Send to" offers recruiting addresses only; founders, executives and
  // other teams are listed apart and never picked by default.
  const emails = outreach.contacts.filter(isRecruitingContact);
  const otherEmails = outreach.contacts.filter(
    (c) => c.kind === "email" && !isRecruitingContact(c),
  );
  const pages = outreach.contacts.filter(
    (c) => c.kind === "application_form" || c.kind === "careers_page",
  );
  const people = outreach.contacts.filter((c) => c.kind === "linkedin_person");
  const [recipient, setRecipient] = React.useState<OutreachContact | null>(
    () =>
      outreach.contacts.find(
        (c) => c.kind === "email" && c.value === outreach.email?.recipient,
      ) ??
      emails[0] ??
      null,
  );
  // Contacts arrive after the page first renders (the search runs in the
  // background): pick the best address once they do, unless one is chosen.
  const firstEmail = emails[0] ?? null;
  React.useEffect(() => {
    if (!recipient && firstEmail) setRecipient(firstEmail);
  }, [recipient, firstEmail]);
  const [targetRole, setTargetRole] = React.useState(
    outreach.email?.targetRole ?? "",
  );
  const [language, setLanguage] = React.useState<"fr" | "en">(
    outreach.email?.language ?? "fr",
  );
  const [subject, setSubject] = React.useState(outreach.email?.subject ?? "");
  const [body, setBody] = React.useState(outreach.email?.body ?? "");
  const [askSent, setAskSent] = React.useState(false);

  const setOutreach = (next: SpontaneousOutreach) => {
    queryClient.setQueryData(outreachKey(next.id), next);
    void queryClient.invalidateQueries({ queryKey: historyKey });
  };

  const writeMutation = useMutation({
    mutationFn: () =>
      api.writeSpontaneousEmail(outreach.id, {
        recipient: recipient?.value ?? null,
        recipientName: recipient?.name ?? null,
        targetRole: targetRole.trim() || null,
        language,
      }),
    onSuccess: (next) => {
      setOutreach(next);
      setSubject(next.email?.subject ?? "");
      setBody(next.email?.body ?? "");
    },
    onError: (error) => showErrorToast(error, "Could not write the email."),
  });

  const sentMutation = useMutation({
    mutationFn: () =>
      api.logSpontaneousSent(outreach.id, {
        recipient: recipient?.value ?? null,
        subject,
        body,
      }),
    onSuccess: (next) => {
      setOutreach(next);
      setAskSent(false);
      toast.success("Logged: it's on your Applications board.");
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error) => showErrorToast(error, "Could not log it."),
  });

  if (outreach.status === "researching") {
    return (
      <Step n={2} title={`Who to write to at ${outreach.company}`}>
        <output className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Searching the web for recruiting addresses, forms and recruiters, then
          checking every source. This usually takes 1 to 3 minutes.
        </output>
      </Step>
    );
  }

  if (outreach.status === "failed") {
    return (
      <Step n={2} title={`Who to write to at ${outreach.company}`}>
        <p className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          {outreach.error ?? "The search failed."}
        </p>
        <Button size="sm" onClick={onSearchAgain}>
          Search again
        </Button>
      </Step>
    );
  }

  const mailtoFull = `mailto:${recipient?.value ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const mailtoShort = `mailto:${recipient?.value ?? ""}?subject=${encodeURIComponent(subject)}`;
  const mailtoTooLong = mailtoFull.length > MAX_MAILTO_LENGTH;
  const verifiedFacts = outreach.facts.filter((f) => f.check === "verified");

  return (
    <>
      <Step
        n={2}
        title={`Who to write to at ${outreach.company}`}
        done={Boolean(outreach.email)}
      >
        {outreach.summary && (
          <p className="rounded-lg bg-muted/50 p-3 text-sm leading-6">
            {outreach.summary}
          </p>
        )}
        {emails.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No recruiting address was found. Best next step: apply through the
            application form or careers page below, or message one of the
            recruiters on LinkedIn. You can still write the email here and paste
            it into the form or the LinkedIn message.
          </p>
        )}
        {emails.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Send to
            </legend>
            {emails.map((contact) => (
              <label
                key={contact.value}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-lg border p-3",
                  recipient?.value === contact.value
                    ? "border-primary/60 bg-primary/5"
                    : "border-border/50",
                )}
              >
                <input
                  type="radio"
                  name="recipient"
                  className="mt-1"
                  checked={recipient?.value === contact.value}
                  onChange={() => setRecipient(contact)}
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="break-all text-sm font-medium">
                    {contact.value}
                  </p>
                  {(contact.name || contact.title) && (
                    <p className="text-xs text-muted-foreground">
                      {[contact.name, contact.title]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-2">
                    <CheckLabel contact={contact} />
                    {contact.sourceUrl && (
                      <a
                        href={contact.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                      >
                        source <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </label>
            ))}
          </fieldset>
        )}
        {[...pages, ...people].length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Other ways in
            </p>
            <ul className="space-y-2">
              {[...pages, ...people].map((contact) => (
                <li key={contact.value} className="flex gap-3 text-sm">
                  <ContactIcon contact={contact} />
                  <div className="min-w-0 flex-1">
                    <a
                      href={contact.value}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
                    >
                      {contact.kind === "linkedin_person"
                        ? contact.name || "LinkedIn profile"
                        : KIND_LABELS[contact.kind]}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    <p className="text-xs text-muted-foreground">
                      {contact.kind === "linkedin_person"
                        ? contact.title || "Recruiting"
                        : hostOf(contact.value)}
                    </p>
                    <CheckLabel contact={contact} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {otherEmails.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Other addresses (not in recruiting): {otherEmails.length}
            </summary>
            <ul className="mt-2 space-y-1.5">
              {otherEmails.map((contact) => (
                <li
                  key={contact.value}
                  className="flex flex-wrap items-center gap-x-2 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => setRecipient(contact)}
                    className={cn(
                      "break-all font-medium underline-offset-2 hover:underline",
                      recipient?.value === contact.value && "text-primary",
                    )}
                  >
                    {contact.value}
                  </button>
                  <span className="text-muted-foreground">
                    {[contact.name, contact.title].filter(Boolean).join(" · ")}
                  </span>
                  <CheckLabel contact={contact} />
                </li>
              ))}
            </ul>
          </details>
        )}
        {verifiedFacts.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              {verifiedFacts.length} verified facts the email may use
            </summary>
            <ul className="mt-2 space-y-1">
              {verifiedFacts.map((fact) => (
                <li key={fact.claim} className="text-xs">
                  {fact.claim}{" "}
                  <a
                    href={fact.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground underline-offset-2 hover:underline"
                  >
                    ({hostOf(fact.sourceUrl)})
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Step>

      <Step n={3} title="Write the email" done={Boolean(outreach.jobId)}>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input
            aria-label="Role you're after (optional)"
            placeholder="Role you're after (optional), e.g. Data Engineer"
            value={targetRole}
            onChange={(event) => setTargetRole(event.target.value)}
          />
          <fieldset className="flex rounded-md border border-border/60 p-0.5">
            <legend className="sr-only">Language</legend>
            {(["fr", "en"] as const).map((value) => (
              <label
                key={value}
                className={cn(
                  "flex cursor-pointer items-center rounded px-3 text-xs font-medium focus-within:ring-2 focus-within:ring-primary",
                  language === value
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground",
                )}
              >
                <input
                  type="radio"
                  name="email-language"
                  value={value}
                  checked={language === value}
                  onChange={() => setLanguage(value)}
                  className="sr-only"
                />
                {value === "fr" ? "Français" : "English"}
              </label>
            ))}
          </fieldset>
          <Button
            onClick={() => writeMutation.mutate()}
            disabled={writeMutation.isPending || Boolean(outreach.jobId)}
          >
            {writeMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <PenLine className="mr-1.5 h-3.5 w-3.5" />
            )}
            {outreach.email ? "Rewrite" : "Write it"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Written from your {language === "fr" ? "French" : "English"} CV and
          the verified facts only.
        </p>
        {outreach.email && (
          <div className="space-y-2">
            <Input
              aria-label="Subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
            <Textarea
              aria-label="Email"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="min-h-[16rem] text-sm leading-6"
            />
            {outreach.email.unsupportedTerms.length > 0 && (
              <p className="flex gap-1.5 text-xs text-amber-800 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Not in your CV or the verified facts:{" "}
                {outreach.email.unsupportedTerms.join(", ")}. Keep these words
                only if they are true.
              </p>
            )}
          </div>
        )}
      </Step>

      {outreach.email && (
        <Step n={4} title="Send it" done={Boolean(outreach.jobId)}>
          {outreach.jobId ? (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Sent and logged.
              <Link
                to="/applications/in-progress"
                className="text-primary underline-offset-2 hover:underline"
              >
                See it on your Applications board
              </Link>
              ·
              <Link
                to={`/job/${outreach.jobId}`}
                className="text-primary underline-offset-2 hover:underline"
              >
                Open it
              </Link>
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <a
                    href={mailtoTooLong ? mailtoShort : mailtoFull}
                    onClick={() => {
                      if (mailtoTooLong) {
                        void navigator.clipboard
                          ?.writeText(body)
                          .then(() =>
                            toast.info(
                              "The email text is copied: paste it into the message.",
                            ),
                          );
                      }
                      setAskSent(true);
                    }}
                  >
                    <Mail className="mr-1.5 h-3.5 w-3.5" />
                    Open in my mail app
                  </a>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(
                        `${recipient ? `${recipient.value}\n` : ""}${subject}\n\n${body}`,
                      )
                      .then(() => toast.success("Copied"));
                    setAskSent(true);
                  }}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Copy all
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void downloadCv(language).catch((error) =>
                      showErrorToast(error, "Could not create the CV PDF."),
                    );
                  }}
                >
                  <FileDown className="mr-1.5 h-3.5 w-3.5" />
                  My CV to attach ({language.toUpperCase()})
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {recipient
                  ? "Don't forget to attach your CV before sending."
                  : "No address chosen: copy the email and paste it into the application form or a LinkedIn message, with your CV attached."}
              </p>
              {askSent && (
                <output className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                  <span className="min-w-0 flex-1">
                    Did you send it? Log it so it appears on your Applications
                    board and you get a follow-up reminder.
                  </span>
                  <Button
                    size="sm"
                    onClick={() => sentMutation.mutate()}
                    disabled={sentMutation.isPending}
                  >
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    Yes, log it
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setAskSent(false)}
                  >
                    Not yet
                  </Button>
                </output>
              )}
            </>
          )}
        </Step>
      )}
    </>
  );
}
