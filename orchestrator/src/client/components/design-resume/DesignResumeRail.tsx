import type {
  DesignResumeAiGuidance,
  DesignResumeDocument,
  DesignResumeJson,
} from "@shared/types";
import { AlertCircle, Check, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { Accordion } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { DesignResumeAiGuidancePanel } from "./DesignResumeAiGuidancePanel";
import {
  BasicsCustomFieldsSection,
  BasicsSection,
  PictureSection,
  SummarySection,
} from "./DesignResumeInlineSections";
import { DesignResumeListSection } from "./DesignResumeListSection";
import { DesignResumeSection } from "./DesignResumeSection";
import { ITEM_DEFINITIONS, type ItemDefinition } from "./definitions";
import { asArray, asRecord, setByPath } from "./utils";

export type DesignResumeSaveState = "idle" | "saving" | "saved" | "error";

type DesignResumeRailProps = {
  draft: DesignResumeDocument;
  onUpdateResumeJson: (
    updater: (resumeJson: DesignResumeJson) => DesignResumeJson,
  ) => void;
  onUpdateAiGuidance: (
    updater: (guidance: DesignResumeAiGuidance) => DesignResumeAiGuidance,
  ) => void;
  saveState: DesignResumeSaveState;
  isDirty: boolean;
  className?: string;
  onOpenDialog: (definition: ItemDefinition, index: number | null) => void;
  onUploadPicture: () => void;
  onDeletePicture: () => void;
  pictureUploading: boolean;
};

function SaveIndicator({
  saveState,
  isDirty,
}: {
  saveState: DesignResumeSaveState;
  isDirty: boolean;
}) {
  if (saveState === "error") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-rose-400">
        <AlertCircle className="h-3.5 w-3.5" />
        Not saved
      </span>
    );
  }
  if (saveState === "saving" || isDirty) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Saving…
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Check className="h-3.5 w-3.5 text-emerald-400" />
      Saved
    </span>
  );
}

/** Short per-item descriptions of AI guidance, shown as a sparkle on rows. */
function buildItemAiHints(
  guidance: DesignResumeAiGuidance,
): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const [id, item] of Object.entries(guidance.items)) {
    const parts: string[] = [];
    if (item.include === "always") parts.push("Always included");
    if (item.include === "never") parts.push("Never included");
    if (item.include === "auto") parts.push("AI decides");
    if (item.notes?.trim()) parts.push("Has an AI note");
    if (parts.length > 0) hints[id] = parts.join(" · ");
  }
  return hints;
}

export function DesignResumeRail({
  draft,
  onUpdateResumeJson,
  onUpdateAiGuidance,
  saveState,
  isDirty,
  className,
  onOpenDialog,
  onUploadPicture,
  onDeletePicture,
  pictureUploading,
}: DesignResumeRailProps) {
  const resumeJson = draft.resumeJson as Record<string, unknown>;
  const basics = (asRecord(resumeJson.basics) ?? {}) as Record<string, unknown>;
  const picture = (asRecord(resumeJson.picture) ?? {}) as Record<
    string,
    unknown
  >;
  const summary = (asRecord(resumeJson.summary) ?? {}) as Record<
    string,
    unknown
  >;
  const sections = (asRecord(resumeJson.sections) ?? {}) as Record<
    string,
    unknown
  >;
  const customFields = asArray(basics.customFields) as Record<
    string,
    unknown
  >[];

  const updateBasics = (path: string, value: unknown) => {
    onUpdateResumeJson((current) => {
      const next = structuredClone(current);
      const currentBasics = (asRecord(next.basics) ?? {}) as Record<
        string,
        unknown
      >;
      next.basics = setByPath(
        currentBasics,
        path,
        value,
      ) as DesignResumeJson["basics"];
      return next;
    });
  };

  const updatePicture = (key: string, value: unknown) => {
    onUpdateResumeJson((current) => {
      const next = structuredClone(current);
      const currentPicture = (asRecord(next.picture) ?? {}) as Record<
        string,
        unknown
      >;
      next.picture = {
        ...currentPicture,
        [key]: value,
      } as DesignResumeJson["picture"];
      return next;
    });
  };

  const updateSummary = (key: string, value: unknown) => {
    onUpdateResumeJson((current) => {
      const next = structuredClone(current);
      const currentSummary = (asRecord(next.summary) ?? {}) as Record<
        string,
        unknown
      >;
      next.summary = {
        ...currentSummary,
        [key]: value,
      } as DesignResumeJson["summary"];
      return next;
    });
  };

  const updateCustomFields = (nextFields: Record<string, unknown>[]) => {
    onUpdateResumeJson((current) => {
      const next = structuredClone(current);
      const currentBasics = (asRecord(next.basics) ?? {}) as Record<
        string,
        unknown
      >;
      next.basics = {
        ...currentBasics,
        customFields: nextFields,
      } as DesignResumeJson["basics"];
      return next;
    });
  };

  const updateSectionItems = (
    sectionKey: string,
    nextItems: Record<string, unknown>[],
  ) => {
    onUpdateResumeJson((current) => {
      const next = structuredClone(current);
      const currentSections = (asRecord(next.sections) ?? {}) as Record<
        string,
        unknown
      >;
      next.sections = {
        ...currentSections,
        [sectionKey]: {
          ...(asRecord(currentSections[sectionKey]) ?? {}),
          // Keep edited sections visible in preview/PDF when items are managed here.
          hidden: false,
          items: nextItems,
        },
      } as DesignResumeJson["sections"];
      return next;
    });
  };

  const [tab, setTab] = useState<"content" | "ai">("content");
  const aiHints = buildItemAiHints(draft.aiGuidance);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value === "ai" ? "ai" : "content")}
      className={cn("flex h-full min-h-0 flex-col", className)}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <TabsList className="h-9">
          <TabsTrigger value="content" className="px-3 text-xs">
            Content
          </TabsTrigger>
          <TabsTrigger value="ai" className="gap-1.5 px-3 text-xs">
            <Sparkles className="h-3.5 w-3.5" />
            AI guidance
          </TabsTrigger>
        </TabsList>
        <SaveIndicator saveState={saveState} isDirty={isDirty} />
      </div>

      <TabsContent
        value="ai"
        className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden"
      >
        <DesignResumeAiGuidancePanel
          guidance={draft.aiGuidance}
          resumeJson={draft.resumeJson}
          onChange={onUpdateAiGuidance}
        />
      </TabsContent>

      <TabsContent
        value="content"
        className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden"
      >
        <Accordion type="multiple" defaultValue={[]} className="space-y-3">
          <DesignResumeSection
            value="picture"
            title="Picture"
            subtitle="Manage your resume photo and how it appears."
          >
            <PictureSection
              picture={picture}
              pictureUploading={pictureUploading}
              onUploadPicture={onUploadPicture}
              onDeletePicture={onDeletePicture}
              onUpdatePicture={updatePicture}
            />
          </DesignResumeSection>

          <DesignResumeSection
            value="basics"
            title="Basics"
            subtitle="Edit your name, headline, and contact details."
          >
            <BasicsSection basics={basics} onUpdateBasics={updateBasics} />
          </DesignResumeSection>

          <DesignResumeSection
            value="basics-custom-fields"
            title="Basics Custom Fields"
            subtitle="Add extra links or short details near your contact info."
            badge={
              customFields.length === 0 ? "Empty" : `${customFields.length}`
            }
          >
            <BasicsCustomFieldsSection
              customFields={customFields}
              onChange={updateCustomFields}
            />
          </DesignResumeSection>

          <DesignResumeSection
            value="summary"
            title="Summary"
            subtitle="Write the short intro that appears near the top of your resume."
          >
            <SummarySection summary={summary} onUpdateSummary={updateSummary} />
          </DesignResumeSection>

          {ITEM_DEFINITIONS.map((definition) => {
            const section = (asRecord(sections[definition.key]) ??
              {}) as Record<string, unknown>;
            const items = asArray(section.items).map(
              (item) => asRecord(item) ?? {},
            ) as Record<string, unknown>[];

            return (
              <DesignResumeListSection
                key={definition.key}
                definition={definition}
                items={items}
                onAdd={() => onOpenDialog(definition, null)}
                onEdit={(index) => onOpenDialog(definition, index)}
                onUpdateItems={(nextItems) =>
                  updateSectionItems(definition.key, nextItems)
                }
                aiHints={aiHints}
              />
            );
          })}
        </Accordion>
      </TabsContent>
    </Tabs>
  );
}
