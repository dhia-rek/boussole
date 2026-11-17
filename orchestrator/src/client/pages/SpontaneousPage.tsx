import { fetchApi } from "@client/api/core";
import {
  AlertCircle,
  Building2,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Globe,
  Languages,
  Loader2,
  Mail,
  Search,
  Send,
  User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { PageHeader, PageMain } from "../components";

interface HunterContact {
  email: string;
  name: string | null;
  position: string | null;
  confidence: number;
}

interface LookupResult {
  organization: string;
  domain: string;
  pattern: string | null;
  emails: HunterContact[];
}

interface GeneratedEmail {
  subject: string;
  body: string;
}

type StepState = "done" | "active" | "upcoming";

function StepBadge({ n, state }: { n: number; state: StepState }) {
  if (state === "done") {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
        <Check className="h-3.5 w-3.5" />
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
        state === "active"
          ? "bg-primary-500/20 text-primary-400"
          : "bg-muted/40 text-muted-foreground",
      )}
    >
      {n}
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  const cls =
    score >= 80
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : score >= 60
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : "border-orange-500/30 bg-orange-500/10 text-orange-300";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        cls,
      )}
    >
      {score}%
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="h-7 px-2 text-xs gap-1"
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-400" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      {copied ? "Copied" : (label ?? "Copy")}
    </Button>
  );
}

export function SpontaneousPage() {
  const [domain, setDomain] = useState("");
  const [isLooking, setIsLooking] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<HunterContact | null>(
    null,
  );
  const [targetRole, setTargetRole] = useState("");
  const [language, setLanguage] = useState<"en" | "fr">("en");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedEmail, setGeneratedEmail] = useState<GeneratedEmail | null>(
    null,
  );
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [editedSubject, setEditedSubject] = useState("");
  const [editedBody, setEditedBody] = useState("");

  const step2Ref = useRef<HTMLDivElement>(null);

  // Keep the editable draft in sync with each fresh generation / regeneration.
  useEffect(() => {
    if (generatedEmail) {
      setEditedSubject(generatedEmail.subject);
      setEditedBody(generatedEmail.body);
    }
  }, [generatedEmail]);

  // Progressive disclosure: pull the user to the recipient list after a hit.
  useEffect(() => {
    if (lookupResult && step2Ref.current) {
      step2Ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [lookupResult]);

  const wordCount = editedBody.trim()
    ? editedBody.trim().split(/\s+/).length
    : 0;
  const overWordLimit = wordCount > 250;

  const step1State: StepState = lookupResult ? "done" : "active";
  const step2State: StepState = !lookupResult ? "upcoming" : "done";
  const step3State: StepState = !lookupResult
    ? "upcoming"
    : generatedEmail
      ? "done"
      : "active";

  const handleLookup = async () => {
    const trimmed = domain.trim();
    if (!trimmed) return;
    setIsLooking(true);
    setLookupError(null);
    setLookupResult(null);
    setSelectedEmail(null);
    setGeneratedEmail(null);
    setGenerateError(null);
    try {
      const result = await fetchApi<LookupResult>("/spontaneous/lookup", {
        method: "POST",
        body: JSON.stringify({ domain: trimmed }),
      });
      setLookupResult(result);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setIsLooking(false);
    }
  };

  const handleGenerate = async () => {
    if (!lookupResult) return;
    setIsGenerating(true);
    setGenerateError(null);
    setGeneratedEmail(null);
    try {
      const result = await fetchApi<GeneratedEmail>(
        "/spontaneous/generate-email",
        {
          method: "POST",
          body: JSON.stringify({
            company: lookupResult.organization,
            recipientName: selectedEmail?.name ?? undefined,
            recipientPosition: selectedEmail?.position ?? undefined,
            targetRole: targetRole.trim() || undefined,
            language,
          }),
        },
      );
      setGeneratedEmail(result);
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : "Email generation failed",
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReset = () => {
    setDomain("");
    setLookupResult(null);
    setLookupError(null);
    setSelectedEmail(null);
    setGeneratedEmail(null);
    setGenerateError(null);
    setTargetRole("");
  };

  return (
    <>
      <PageHeader
        icon={Send}
        title="Spontaneous Applications"
        subtitle="Find HR contacts and generate personalized cold emails"
      />

      <PageMain>
        <div className="max-w-3xl space-y-6">
          {/* Step 1 — Domain search */}
          <section className="rounded-xl border border-border/60 bg-card/40 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <StepBadge n={1} state={step1State} />
              <h2 className="text-sm font-semibold text-foreground">
                Find HR contacts
              </h2>
            </div>

            {lookupResult ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/10 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">Searched</span>
                  <span className="truncate font-medium text-foreground">
                    {lookupResult.domain}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  className="shrink-0"
                >
                  Change
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative flex-1">
                    <label htmlFor="spontaneous-domain" className="sr-only">
                      Company domain
                    </label>
                    <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="spontaneous-domain"
                      placeholder="company.com or https://company.com"
                      value={domain}
                      onChange={(e) => {
                        setDomain(e.target.value);
                        if (lookupError) setLookupError(null);
                      }}
                      onKeyDown={(e) =>
                        e.key === "Enter" && !isLooking && handleLookup()
                      }
                      className="w-full pl-10"
                      disabled={isLooking}
                      autoFocus
                    />
                  </div>
                  <Button
                    onClick={handleLookup}
                    disabled={isLooking || !domain.trim()}
                    className="w-full sm:w-auto"
                  >
                    {isLooking ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    {isLooking ? "Searching…" : "Search"}
                  </Button>
                </div>

                {lookupError && <InlineError message={lookupError} />}

                <p className="text-xs text-muted-foreground">
                  Powered by Hunter.io — requires a Hunter.io API key in
                  Settings.
                </p>
              </>
            )}
          </section>

          {/* Step 2 — Recipient list */}
          {lookupResult && (
            <section
              ref={step2Ref}
              className="rounded-xl border border-border/60 bg-card/40 p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StepBadge n={2} state={step2State} />
                  <h2 className="text-sm font-semibold text-foreground">
                    Select a recipient
                  </h2>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" />
                  <span className="font-medium text-foreground">
                    {lookupResult.organization}
                  </span>
                  {lookupResult.pattern && (
                    <span className="opacity-60">· {lookupResult.pattern}</span>
                  )}
                </div>
              </div>

              {lookupResult.emails.length === 0 ? (
                <div className="rounded-lg border border-border/40 bg-muted/20 p-6 text-center">
                  <Mail className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm font-medium text-foreground">
                    No emails found
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Hunter.io found no publicly listed emails for this domain.
                    You can still generate a generic email below.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Generic HR option */}
                  <button
                    type="button"
                    onClick={() => setSelectedEmail(null)}
                    className={cn(
                      "w-full rounded-lg border px-4 py-3 text-left transition-colors",
                      selectedEmail === null
                        ? "border-primary-500/50 bg-primary-500/10"
                        : "border-border/60 bg-muted/10 hover:bg-muted/30",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <User className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          HR / Recruitment team
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Generic — no specific recipient
                        </p>
                      </div>
                      {selectedEmail === null && (
                        <Check className="h-4 w-4 text-primary-400 shrink-0" />
                      )}
                    </div>
                  </button>

                  {lookupResult.emails.map((contact) => (
                    <button
                      key={contact.email}
                      type="button"
                      onClick={() => setSelectedEmail(contact)}
                      className={cn(
                        "w-full rounded-lg border px-4 py-3 text-left transition-colors",
                        selectedEmail?.email === contact.email
                          ? "border-primary-500/50 bg-primary-500/10"
                          : "border-border/60 bg-muted/10 hover:bg-muted/30",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground truncate">
                              {contact.name ?? contact.email}
                            </span>
                            <ConfidenceBadge score={contact.confidence} />
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                            <span className="truncate">{contact.email}</span>
                            {contact.position && (
                              <>
                                <span>·</span>
                                <span className="truncate">
                                  {contact.position}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Step 3 — Generate email */}
          {lookupResult && (
            <section className="rounded-xl border border-border/60 bg-card/40 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <StepBadge n={3} state={step3State} />
                <h2 className="text-sm font-semibold text-foreground">
                  Generate cold email
                </h2>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    htmlFor="spontaneous-target-role"
                    className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Target role (optional)
                  </label>
                  <Input
                    id="spontaneous-target-role"
                    placeholder="e.g. Software Engineer, Data Analyst"
                    value={targetRole}
                    onChange={(e) => setTargetRole(e.target.value)}
                    disabled={isGenerating}
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="spontaneous-language"
                    className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Language
                  </label>
                  <Select
                    value={language}
                    onValueChange={(v) => setLanguage(v as "en" | "fr")}
                    disabled={isGenerating}
                  >
                    <SelectTrigger
                      id="spontaneous-language"
                      aria-label="Language"
                    >
                      <Languages className="h-4 w-4 mr-1 text-muted-foreground" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="fr">Français</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="w-full sm:w-auto"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Generate email
                    </>
                  )}
                </Button>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  Generated from your saved profile
                </span>
              </div>

              {generateError && <InlineError message={generateError} />}

              {/* Generated result — editable before sending */}
              {generatedEmail && (
                <div className="mt-2 space-y-3 rounded-xl border border-border/60 bg-background/60 p-4">
                  {/* Subject */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="spontaneous-subject"
                        className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        Subject
                      </label>
                      <CopyButton text={editedSubject} />
                    </div>
                    <Input
                      id="spontaneous-subject"
                      value={editedSubject}
                      onChange={(e) => setEditedSubject(e.target.value)}
                      className="text-sm font-medium"
                    />
                  </div>

                  <div className="h-px bg-border/40" />

                  {/* Body */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="spontaneous-body"
                        className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        Body
                      </label>
                      <div className="flex gap-1">
                        <CopyButton text={editedBody} />
                        <CopyButton
                          text={`Subject: ${editedSubject}\n\n${editedBody}`}
                          label="Copy all"
                        />
                      </div>
                    </div>
                    <Textarea
                      id="spontaneous-body"
                      value={editedBody}
                      onChange={(e) => setEditedBody(e.target.value)}
                      rows={12}
                      className="text-sm leading-relaxed"
                    />
                    <div className="flex justify-end">
                      <span
                        className={cn(
                          "text-xs",
                          overWordLimit
                            ? "font-medium text-amber-400"
                            : "text-muted-foreground",
                        )}
                      >
                        {wordCount} / 250 words
                        {overWordLimit && " — consider trimming"}
                      </span>
                    </div>
                  </div>

                  {selectedEmail && (
                    <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                      <Mail className="h-3.5 w-3.5" />
                      <span>
                        Send to:{" "}
                        <span className="text-foreground font-medium">
                          {selectedEmail.email}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          navigator.clipboard.writeText(selectedEmail.email)
                        }
                        className="hover:text-foreground transition-colors"
                        title="Copy email address"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  )}

                  <div className="flex gap-2 flex-wrap pt-1">
                    <Badge variant="secondary" className="text-xs">
                      {language === "fr" ? "Français" : "English"}
                    </Badge>
                    {targetRole && (
                      <Badge variant="secondary" className="text-xs">
                        {targetRole}
                      </Badge>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGenerate}
                      className="h-6 px-2 text-xs ml-auto"
                      disabled={isGenerating}
                    >
                      Regenerate
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </PageMain>
    </>
  );
}
