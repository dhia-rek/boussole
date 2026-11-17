import { Upload } from "lucide-react";
import type React from "react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import type { ValidationState } from "../types";
import { InlineValidation } from "./InlineValidation";

export const BaseResumeStep: React.FC<{
  baseResumeValidation: ValidationState;
  isBusy: boolean;
  isImportingResume: boolean;
  onImportResumeFile: (file: File) => Promise<void>;
}> = ({
  baseResumeValidation,
  isBusy,
  isImportingResume,
  onImportResumeFile,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) {
            void onImportResumeFile(file);
          }
          event.currentTarget.value = "";
        }}
      />

      <div className="rounded-xl border border-border/60 bg-muted/10 p-5">
        <div className="space-y-2">
          <div className="text-sm font-medium">Upload a PDF or DOCX CV</div>
          <p className="text-sm text-muted-foreground">
            Boussole reads the file with Claude and saves it as your CV in the
            CV editor, where you can check and edit every section.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy || isImportingResume}
          >
            <Upload className="h-4 w-4" />
            {isImportingResume ? "Reading your CV..." : "Upload CV file"}
          </Button>
          <div className="text-xs text-muted-foreground">
            Supported formats: PDF and DOCX.
          </div>
        </div>

        {isImportingResume && (
          <div className="mt-3 space-y-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full animate-[progress-indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
            </div>
            <p className="text-xs text-muted-foreground">
              Reading with Claude. This takes 10 to 30 seconds.
            </p>
          </div>
        )}
      </div>

      <InlineValidation
        state={baseResumeValidation}
        successMessage="Your CV is loaded and ready."
      />
    </div>
  );
};
