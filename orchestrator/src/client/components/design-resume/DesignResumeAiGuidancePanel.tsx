import {
  createDefaultDesignResumeAiSectionGuidance,
  DESIGN_RESUME_AI_LIMITS,
  isDesignResumeAiTailorableSection,
} from "@shared/design-resume-ai-guidance";
import type {
  DesignResumeAiGuidance,
  DesignResumeAiItemGuidance,
  DesignResumeAiItemInclusion,
  DesignResumeAiMode,
  DesignResumeAiSectionGuidance,
  DesignResumeAiSectionKey,
  DesignResumeJson,
} from "@shared/types";
import { Lock, Sparkles } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ITEM_DEFINITIONS } from "./definitions";
import { asArray, asRecord, fieldId, getByPath, toText } from "./utils";

type GuidanceUpdater = (
  guidance: DesignResumeAiGuidance,
) => DesignResumeAiGuidance;

type SectionConfig = {
  key: DesignResumeAiSectionKey;
  title: string;
  /** What the AI does in each mode (tailorable sections) or always. */
  tailorText?: string;
  keepText: string;
  tailorLabel?: string;
  keepLabel?: string;
  notesPlaceholder: string;
  /** `sections.<key>` whose entries can carry their own notes. */
  itemSection?: "projects" | "experience" | "education";
};

const SECTION_CONFIGS: SectionConfig[] = [
  {
    key: "headline",
    title: "Headline",
    tailorLabel: "Match each job",
    keepLabel: "Keep as written",
    tailorText: "Replaced by each job's title, so ATS filters match it.",
    keepText: "Every tailored CV uses your headline exactly as written.",
    notesPlaceholder: "e.g. Keep it under 8 words.",
  },
  {
    key: "summary",
    title: "Summary",
    tailorLabel: "Rewrite per job",
    keepLabel: "Keep as written",
    tailorText: "Rewritten for each job from your real experience.",
    keepText: "Every tailored CV uses your summary exactly as written.",
    notesPlaceholder:
      "e.g. Mention I'm looking for a 6-month end-of-studies internship.",
  },
  {
    key: "skills",
    title: "Skills",
    tailorLabel: "Match each job",
    keepLabel: "Keep as written",
    tailorText: "Keywords are reordered and renamed to mirror each job.",
    keepText: "Every tailored CV uses your skills exactly as written.",
    notesPlaceholder: "e.g. Always keep Python and LLMs first.",
  },
  {
    key: "projects",
    title: "Projects",
    tailorLabel: "AI picks",
    keepLabel: "Keep as shown",
    tailorText:
      "The most relevant projects are picked for each job. Pin the ones that must always (or never) appear.",
    keepText:
      "Every tailored CV shows exactly the projects visible in your CV.",
    notesPlaceholder: "e.g. Prefer GenAI projects for LLM roles.",
    itemSection: "projects",
  },
  {
    key: "experience",
    title: "Experience",
    keepText: "Always copied verbatim — the AI never rewrites it.",
    notesPlaceholder:
      "Context the AI can use when scoring jobs and writing cover letters.",
    itemSection: "experience",
  },
  {
    key: "education",
    title: "Education",
    keepText: "Always copied verbatim — the AI never rewrites it.",
    notesPlaceholder: "e.g. My MSc thesis is on AI-driven data quality.",
    itemSection: "education",
  },
  {
    key: "languages",
    title: "Languages",
    keepText: "Always copied verbatim.",
    notesPlaceholder: "e.g. Fully professional in French and English.",
  },
  {
    key: "certifications",
    title: "Certifications",
    keepText: "Always copied verbatim.",
    notesPlaceholder: "Anything the AI should know about your certificates.",
  },
  {
    key: "awards",
    title: "Awards",
    keepText: "Always copied verbatim.",
    notesPlaceholder: "Anything the AI should know about your awards.",
  },
  {
    key: "publications",
    title: "Publications",
    keepText: "Always copied verbatim.",
    notesPlaceholder: "Anything the AI should know about your publications.",
  },
  {
    key: "volunteer",
    title: "Volunteering",
    keepText: "Always copied verbatim.",
    notesPlaceholder: "Anything the AI should know about your volunteering.",
  },
  {
    key: "interests",
    title: "Interests",
    keepText: "Always copied verbatim.",
    notesPlaceholder: "Anything the AI should know about your interests.",
  },
  {
    key: "references",
    title: "References",
    keepText:
      "Always copied verbatim. Private by default (third-party contacts).",
    notesPlaceholder: "Anything the AI should know about your references.",
  },
  {
    key: "profiles",
    title: "Profiles & links",
    keepText: "Always copied verbatim. Private by default.",
    notesPlaceholder: "Anything the AI should know about your profiles.",
  },
];

const INCLUDE_OPTIONS: Array<{
  value: DesignResumeAiItemInclusion | "default";
  label: string;
}> = [
  { value: "default", label: "Default" },
  { value: "always", label: "Always include" },
  { value: "auto", label: "AI decides" },
  { value: "never", label: "Never include" },
];

function NotesField({
  id,
  label,
  value,
  maxLength,
  placeholder,
  disabled,
  rows = 2,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  maxLength: number;
  placeholder: string;
  disabled?: boolean;
  rows?: number;
  onChange: (value: string) => void;
}) {
  const nearLimit = value.length > maxLength * 0.8;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={id}
          className="text-xs font-medium text-muted-foreground"
        >
          {label}
        </label>
        {nearLimit ? (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {value.length}/{maxLength}
          </span>
        ) : null}
      </div>
      <Textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        className="min-h-0 resize-y bg-background/60 text-sm"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}

function ModeToggle({
  name,
  value,
  tailorLabel,
  keepLabel,
  onChange,
}: {
  name: string;
  value: DesignResumeAiMode;
  tailorLabel: string;
  keepLabel: string;
  onChange: (mode: DesignResumeAiMode) => void;
}) {
  const options: Array<{ mode: DesignResumeAiMode; label: string }> = [
    { mode: "tailor", label: tailorLabel },
    { mode: "keep", label: keepLabel },
  ];
  return (
    <fieldset className="m-0 inline-flex min-w-0 rounded-lg border border-border/60 bg-muted/30 p-0.5">
      <legend className="sr-only">{`${name}: how the AI may change it`}</legend>
      {options.map((option) => {
        const selected = option.mode === value;
        return (
          <button
            key={option.mode}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.mode)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}

function SectionChips({
  config,
  section,
  hasItemNotes,
}: {
  config: SectionConfig;
  section: DesignResumeAiSectionGuidance;
  hasItemNotes: boolean;
}) {
  const tailorable = isDesignResumeAiTailorableSection(config.key);
  const chips: Array<{ label: string; tone: "ai" | "neutral" | "warn" }> = [];
  if (tailorable) {
    chips.push(
      section.mode === "tailor"
        ? { label: "AI tailors", tone: "ai" }
        : { label: "Locked", tone: "neutral" },
    );
  } else {
    chips.push({ label: "Verbatim", tone: "neutral" });
  }
  if (!section.share) chips.push({ label: "Private", tone: "warn" });
  if (section.notes.trim() || hasItemNotes) {
    chips.push({ label: "Notes", tone: "neutral" });
  }
  if (config.key === "headline" && section.prefix.trim()) {
    chips.push({ label: `“${section.prefix.trim()} …”`, tone: "neutral" });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={cn(
            "max-w-[10rem] truncate rounded-full border px-2 py-0.5 text-[11px] font-medium",
            chip.tone === "ai" &&
              "border-primary/40 bg-primary/10 text-primary",
            chip.tone === "neutral" && "border-border/60 text-muted-foreground",
            chip.tone === "warn" &&
              "border-amber-500/40 bg-amber-500/10 text-amber-400",
          )}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

type DesignResumeAiGuidancePanelProps = {
  guidance: DesignResumeAiGuidance;
  resumeJson: DesignResumeJson;
  onChange: (updater: GuidanceUpdater) => void;
};

export function DesignResumeAiGuidancePanel({
  guidance,
  resumeJson,
  onChange,
}: DesignResumeAiGuidancePanelProps) {
  const sections = (asRecord(resumeJson.sections) ?? {}) as Record<
    string,
    unknown
  >;

  const updateSection = (
    key: DesignResumeAiSectionKey,
    patch: Partial<DesignResumeAiSectionGuidance>,
  ) => {
    onChange((current) => ({
      ...current,
      sections: {
        ...current.sections,
        [key]: {
          ...(current.sections[key] ??
            createDefaultDesignResumeAiSectionGuidance(key)),
          ...patch,
        },
      },
    }));
  };

  const updateItem = (
    itemId: string,
    patch: Partial<DesignResumeAiItemGuidance>,
  ) => {
    onChange((current) => {
      const merged: DesignResumeAiItemGuidance = {
        ...(current.items[itemId] ?? {}),
        ...patch,
      };
      const next: DesignResumeAiItemGuidance = {};
      if (merged.include) next.include = merged.include;
      if (merged.notes) next.notes = merged.notes;
      const items = { ...current.items };
      if (next.include || next.notes) {
        items[itemId] = next;
      } else {
        delete items[itemId];
      }
      return { ...current, items };
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            Tell the AI how to use this CV
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            These settings are never printed. They steer job scoring, CV
            tailoring and cover letters. Private sections are never sent to the
            AI.
          </p>
        </div>
      </div>

      <Accordion type="multiple" className="space-y-2">
        {SECTION_CONFIGS.map((config) => {
          const section =
            guidance.sections[config.key] ??
            createDefaultDesignResumeAiSectionGuidance(config.key);
          const tailorable = isDesignResumeAiTailorableSection(config.key);
          const definition = config.itemSection
            ? ITEM_DEFINITIONS.find((item) => item.key === config.itemSection)
            : undefined;
          const items = config.itemSection
            ? (asArray(asRecord(sections[config.itemSection])?.items)
                .map((item) => asRecord(item))
                .filter(
                  (item): item is Record<string, unknown> =>
                    Boolean(item) && Boolean(toText(item?.id)),
                ) as Record<string, unknown>[])
            : [];
          const hasItemNotes = items.some((item) =>
            Boolean(guidance.items[toText(item.id)]?.notes?.trim()),
          );

          return (
            <AccordionItem
              key={config.key}
              value={config.key}
              className="overflow-hidden rounded-xl border border-border/60 bg-card/40"
            >
              <AccordionTrigger className="px-4 py-3 text-left hover:no-underline">
                <div className="flex min-w-0 flex-1 items-center justify-between gap-3 pr-3">
                  <span className="text-sm font-semibold text-foreground">
                    {config.title}
                  </span>
                  <SectionChips
                    config={config}
                    section={section}
                    hasItemNotes={hasItemNotes}
                  />
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-4 px-4 pb-4 pt-0">
                {tailorable ? (
                  <div className="space-y-2">
                    <ModeToggle
                      name={config.title}
                      value={section.mode}
                      tailorLabel={config.tailorLabel ?? "Tailor"}
                      keepLabel={config.keepLabel ?? "Keep"}
                      onChange={(mode) => updateSection(config.key, { mode })}
                    />
                    <p className="text-xs leading-5 text-muted-foreground">
                      {section.mode === "tailor"
                        ? config.tailorText
                        : config.keepText}
                    </p>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" />
                    {config.keepText}
                  </p>
                )}

                {config.key === "headline" && section.mode === "tailor" ? (
                  <div className="grid gap-1.5">
                    <label
                      htmlFor={fieldId("ai", "headline", "prefix")}
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Always start with
                    </label>
                    <Input
                      id={fieldId("ai", "headline", "prefix")}
                      value={section.prefix}
                      maxLength={DESIGN_RESUME_AI_LIMITS.prefix}
                      placeholder="e.g. Stagiaire, Intern"
                      className="bg-background/60"
                      onChange={(event) =>
                        updateSection("headline", {
                          prefix: event.currentTarget.value,
                        })
                      }
                    />
                    <p className="text-[11px] leading-4 text-muted-foreground">
                      “Stagiaire” + “Data Scientist (H/F)” → “Stagiaire Data
                      Scientist”.
                    </p>
                  </div>
                ) : null}

                <NotesField
                  id={fieldId("ai", config.key, "notes")}
                  label="Notes for the AI"
                  value={section.notes}
                  maxLength={DESIGN_RESUME_AI_LIMITS.sectionNotes}
                  placeholder={config.notesPlaceholder}
                  disabled={!section.share}
                  onChange={(notes) => updateSection(config.key, { notes })}
                />

                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/40 px-3 py-2">
                  <label
                    htmlFor={fieldId("ai", config.key, "share")}
                    className="text-xs text-muted-foreground"
                  >
                    {section.share
                      ? "Shared with the AI"
                      : "Private — never sent to the AI"}
                  </label>
                  <Switch
                    id={fieldId("ai", config.key, "share")}
                    checked={section.share}
                    onCheckedChange={(share) =>
                      updateSection(config.key, { share })
                    }
                  />
                </div>

                {definition && items.length > 0 && section.share ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      Per entry
                    </div>
                    {items.map((item) => {
                      const itemId = toText(item.id);
                      const itemGuidance = guidance.items[itemId] ?? {};
                      const title = toText(
                        getByPath(item, definition.primaryField),
                        "Untitled",
                      );
                      return (
                        <div
                          key={itemId}
                          className="space-y-2 rounded-lg border border-border/50 bg-background/40 p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-sm font-medium text-foreground">
                              {title.split("|")[0]?.trim() || title}
                            </span>
                            {config.key === "projects" &&
                            section.mode === "tailor" ? (
                              <Select
                                value={itemGuidance.include ?? "default"}
                                onValueChange={(value) =>
                                  updateItem(itemId, {
                                    include:
                                      value === "default"
                                        ? undefined
                                        : (value as DesignResumeAiItemInclusion),
                                  })
                                }
                              >
                                <SelectTrigger
                                  className="h-8 w-[9.5rem] shrink-0 text-xs"
                                  aria-label={`When to include ${title}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {INCLUDE_OPTIONS.map((option) => (
                                    <SelectItem
                                      key={option.value}
                                      value={option.value}
                                    >
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : null}
                          </div>
                          <NotesField
                            id={fieldId("ai", "item", itemId, "notes")}
                            label="Note"
                            rows={1}
                            value={itemGuidance.notes ?? ""}
                            maxLength={DESIGN_RESUME_AI_LIMITS.itemNotes}
                            placeholder="What should the AI know about this entry?"
                            onChange={(notes) => updateItem(itemId, { notes })}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
