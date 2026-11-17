import type { DesignResumeDocument } from "@shared/types";
import { Eye } from "lucide-react";
import { DesignResumePdfPreview } from "./DesignResumePdfPreview";

type DesignResumePreviewPanelProps = {
  draft: DesignResumeDocument;
  /** CV variant shown (e.g. "en"); null → the primary CV. */
  language?: string | null;
  isDirty: boolean;
  saveState: "idle" | "saving" | "saved" | "error";
};

export function DesignResumePreviewPanel({
  draft,
  language = null,
  isDirty,
  saveState,
}: DesignResumePreviewPanelProps) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-muted/20">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
          <Eye className="h-4 w-4 text-muted-foreground" />
          Live preview
          <span className="hidden text-xs font-normal text-muted-foreground md:inline">
            — the exact PDF recruiters will receive
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <DesignResumePdfPreview
          draft={draft}
          language={language}
          isDirty={isDirty}
          saveState={saveState}
        />
      </div>
    </section>
  );
}
