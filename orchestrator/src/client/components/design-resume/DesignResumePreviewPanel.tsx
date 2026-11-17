import type { DesignResumeDocument, PdfRenderer } from "@shared/types";
import { PDF_RENDERER_LABELS } from "@shared/types";
import { Eye } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DesignResumePdfPreview } from "./DesignResumePdfPreview";

type DesignResumePreviewPanelProps = {
  draft: DesignResumeDocument;
  /** CV variant shown (e.g. "en"); null → the primary CV. */
  language?: string | null;
  pdfRenderer: PdfRenderer;
  isUpdatingRenderer: boolean;
  isDirty: boolean;
  saveState: "idle" | "saving" | "saved" | "error";
  onPdfRendererChange: (renderer: PdfRenderer) => void;
};

export function DesignResumePreviewPanel({
  draft,
  language = null,
  pdfRenderer,
  isUpdatingRenderer,
  isDirty,
  saveState,
  onPdfRendererChange,
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

        <div className="flex items-center gap-2">
          <label
            htmlFor="design-resume-template"
            className="text-xs text-muted-foreground"
          >
            Template
          </label>
          <Select
            value={pdfRenderer}
            onValueChange={(value) =>
              onPdfRendererChange(value === "latex" ? "latex" : "rxresume")
            }
            disabled={isUpdatingRenderer}
          >
            <SelectTrigger
              id="design-resume-template"
              className="h-8 w-[13.5rem] text-xs"
            >
              <SelectValue placeholder="Choose a template" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rxresume">
                {PDF_RENDERER_LABELS.rxresume}
              </SelectItem>
              <SelectItem value="latex">{PDF_RENDERER_LABELS.latex}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <DesignResumePdfPreview
          draft={draft}
          language={language}
          pdfRenderer={pdfRenderer}
          isUpdatingRenderer={isUpdatingRenderer}
          isDirty={isDirty}
          saveState={saveState}
        />
      </div>
    </section>
  );
}
