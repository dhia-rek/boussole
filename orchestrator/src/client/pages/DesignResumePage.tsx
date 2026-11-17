import * as api from "@client/api";
import { DesignResumePreviewPanel } from "@client/components/design-resume/DesignResumePreviewPanel";
import {
  DesignResumeRail,
  type DesignResumeSaveState,
} from "@client/components/design-resume/DesignResumeRail";
import { ItemDialog } from "@client/components/design-resume/ItemDialog";
import { PageHeader, PageMain } from "@client/components/layout";
import { useDesignResume } from "@client/hooks/useDesignResume";
import {
  DESIGN_RESUME_LANGUAGE_LABELS,
  DESIGN_RESUME_LANGUAGES,
  type DesignResumeLanguage,
  getDesignResumeLanguageLabel,
  normalizeDesignResumeLanguage,
} from "@shared/design-resume-variants";
import type {
  DesignResumeAiGuidance,
  DesignResumeDocument,
  DesignResumeJson,
  DesignResumeVariantSummary,
} from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileDown,
  FileUp,
  Languages,
  Loader2,
  MoreHorizontal,
  PanelLeft,
  PenSquare,
  Trash2,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
import { downloadDesignResumePdf } from "@/client/lib/private-pdf";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { ItemDefinition } from "../components/design-resume/definitions";
import {
  asArray,
  asRecord,
  fileToDataUrl,
  getDesignResumeDialogItem,
  makeDownload,
} from "../components/design-resume/utils";
import { formatUserFacingError } from "../lib/error-format";
import { queryKeys } from "../lib/queryKeys";

const RESUME_FILE_ACCEPT =
  "application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx";

/** Import target: a language tag, or null for the primary CV. */
type ImportTarget = { language: DesignResumeLanguage | null };

/** One PATCH carries both the CV content and its AI guidance. */
function buildPatch(current: DesignResumeDocument) {
  return {
    baseRevision: current.revision,
    document: structuredClone(current.resumeJson),
    aiGuidance: structuredClone(current.aiGuidance),
  };
}

function variantLabel(variant: Pick<DesignResumeVariantSummary, "language">) {
  return variant.language
    ? getDesignResumeLanguageLabel(variant.language)
    : "CV";
}

function VariantSwitcher({
  variants,
  activeId,
  disabled,
  onSelect,
}: {
  variants: DesignResumeVariantSummary[];
  activeId: string | null;
  disabled: boolean;
  onSelect: (variant: DesignResumeVariantSummary) => void;
}) {
  if (variants.length < 2) return null;
  return (
    <div
      role="tablist"
      aria-label="CV language"
      className="inline-flex shrink-0 rounded-lg border border-border/60 bg-muted/30 p-0.5"
    >
      {variants.map((variant) => {
        const selected = variant.id === activeId;
        return (
          <button
            key={variant.id}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={disabled && !selected}
            onClick={() => onSelect(variant)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {variantLabel(variant)}
            {variant.isPrimary ? (
              <span className="rounded bg-primary/15 px-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                Default
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export const DesignResumePage: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  // `?lang=en` opens that variant; no param → the primary CV.
  const requestedLanguage = normalizeDesignResumeLanguage(
    searchParams.get("lang"),
  );
  const { document, status, isLoading, error } =
    useDesignResume(requestedLanguage);
  const [draft, setDraft] = useState<DesignResumeDocument | null>(null);
  const [saveState, setSaveState] = useState<DesignResumeSaveState>("idle");
  const [dialogState, setDialogState] = useState<{
    definition: ItemDefinition;
    index: number | null;
    seed: Record<string, unknown> | null;
  } | null>(null);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [pictureUploading, setPictureUploading] = useState(false);
  const [resumeImporting, setResumeImporting] = useState(false);
  const [showDeleteVariantConfirm, setShowDeleteVariantConfirm] =
    useState(false);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [switchingVariant, setSwitchingVariant] = useState(false);
  const [dirty, setDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const importTargetRef = useRef<ImportTarget>({ language: null });
  const editVersionRef = useRef(0);
  const draftRef = useRef<DesignResumeDocument | null>(null);
  const readyPdfRefreshToastShownRef = useRef(false);
  draftRef.current = draft;

  const variants = status?.variants ?? [];
  const activeVariant =
    variants.find((variant) => variant.id === draft?.id) ?? null;
  const missingLanguages = DESIGN_RESUME_LANGUAGES.filter(
    (language) => !variants.some((variant) => variant.language === language),
  );

  const notifyReadyPdfRefresh = useCallback(() => {
    if (readyPdfRefreshToastShownRef.current) return;
    readyPdfRefreshToastShownRef.current = true;
    toast.info("Ready PDFs will refresh automatically.");
  }, []);

  const canDownloadPdf = Boolean(draft) && !pdfDownloading;

  useEffect(() => {
    if (!document) return;
    setDraft(document);
    setDirty(false);
  }, [document]);

  // Does a CV belong to the variant the URL asks for? The draft may not after
  // a deep link or browser back/forward to another language.
  const belongsToRequest = useCallback(
    (candidate: DesignResumeDocument | null) =>
      candidate
        ? requestedLanguage
          ? candidate.language === requestedLanguage
          : candidate.isPrimary
        : false,
    [requestedLanguage],
  );
  const draftBelongsToRequest = !draft || belongsToRequest(draft);

  useEffect(() => {
    if (!draft || belongsToRequest(draft)) return;
    // Flush unsaved edits to the CV they were made on (never to the newly
    // requested one), then hand over to the requested CV (or nothing while it
    // loads / when it does not exist).
    if (dirty) {
      void api
        .updateDesignResume(buildPatch(draft), draft.language)
        .then(() =>
          queryClient.invalidateQueries({
            queryKey: queryKeys.designResume.all,
          }),
        )
        .catch((saveError: unknown) =>
          showErrorToast(saveError, "Failed to save your CV."),
        );
    }
    setDraft(belongsToRequest(document) ? document : null);
    setDirty(false);
    setSaveState("idle");
  }, [belongsToRequest, document, draft, dirty, queryClient]);

  /** Caches a saved CV under every query key that can address it. */
  const cacheDocument = useCallback(
    (next: DesignResumeDocument) => {
      queryClient.setQueryData(
        queryKeys.designResume.current(next.language),
        next,
      );
      if (next.isPrimary) {
        queryClient.setQueryData(queryKeys.designResume.current(null), next);
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.designResume.status(),
      });
    },
    [queryClient],
  );

  useEffect(() => {
    if (
      !draft ||
      !document ||
      !dirty ||
      !draftBelongsToRequest ||
      saveState === "saving" ||
      saveState === "error"
    ) {
      return;
    }

    const timer = window.setTimeout(async () => {
      const editVersionAtStart = editVersionRef.current;

      try {
        setSaveState("saving");
        // Always save into the CV the draft was loaded from.
        const updated = await api.updateDesignResume(
          buildPatch(draft),
          draft.language,
        );
        if (editVersionRef.current === editVersionAtStart) {
          cacheDocument(updated);
          setDraft(updated);
          setDirty(false);
          setSaveState("saved");
          notifyReadyPdfRefresh();
          return;
        }

        // Keep newer local edits, but advance the base revision for the next
        // autosave cycle so stale responses never clobber in-flight work.
        setDraft((current) =>
          current
            ? {
                ...updated,
                resumeJson: current.resumeJson,
                aiGuidance: current.aiGuidance,
              }
            : updated,
        );
        setSaveState("idle");
      } catch (saveError) {
        setSaveState("error");
        showErrorToast(saveError, "Failed to save your CV.");
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [
    cacheDocument,
    dirty,
    draft,
    draftBelongsToRequest,
    document,
    notifyReadyPdfRefresh,
    saveState,
  ]);

  const setDesignResume = (next: DesignResumeDocument) => {
    cacheDocument(next);
    setDraft(next);
    setDirty(false);
  };

  const ensureLatestPersistedDraft =
    async (): Promise<DesignResumeDocument | null> => {
      if (!draft) return null;
      if (!dirty) return draft;
      if (saveState === "saving") {
        throw new Error("Your CV is still saving. Try again in a moment.");
      }

      const editVersionAtStart = editVersionRef.current;
      setSaveState("saving");
      const updated = await api.updateDesignResume(
        buildPatch(draft),
        draft.language,
      );

      if (editVersionRef.current === editVersionAtStart) {
        setDesignResume(updated);
        setSaveState("saved");
        return updated;
      }

      const latest = draftRef.current ?? updated;
      const mergedDraft = {
        ...updated,
        resumeJson: structuredClone(latest.resumeJson) as DesignResumeJson,
        aiGuidance: structuredClone(latest.aiGuidance),
      };
      setDraft((current) =>
        current
          ? {
              ...updated,
              resumeJson: current.resumeJson,
              aiGuidance: current.aiGuidance,
            }
          : updated,
      );
      setDirty(true);
      setSaveState("idle");
      return mergedDraft;
    };

  const markEdited = () => {
    editVersionRef.current += 1;
    setDirty(true);
    if (saveState === "saved" || saveState === "error") setSaveState("idle");
  };

  const updateResumeJson = (
    updater: (resumeJson: DesignResumeJson) => DesignResumeJson,
  ) => {
    setDraft((current) =>
      current
        ? { ...current, resumeJson: updater(current.resumeJson) }
        : current,
    );
    markEdited();
  };

  const updateAiGuidance = (
    updater: (guidance: DesignResumeAiGuidance) => DesignResumeAiGuidance,
  ) => {
    setDraft((current) =>
      current
        ? { ...current, aiGuidance: updater(current.aiGuidance) }
        : current,
    );
    markEdited();
  };

  const selectVariant = async (variant: DesignResumeVariantSummary) => {
    if (variant.id === draft?.id) return;
    try {
      // Flush pending edits first: the editor swaps documents on switch.
      setSwitchingVariant(true);
      await ensureLatestPersistedDraft();
      const next = new URLSearchParams(searchParams);
      if (variant.isPrimary || !variant.language) {
        next.delete("lang");
      } else {
        next.set("lang", variant.language);
      }
      setSearchParams(next, { replace: true });
    } catch (switchError) {
      showErrorToast(switchError, "Save your changes before switching.");
    } finally {
      setSwitchingVariant(false);
    }
  };

  const activeDialogItem = useMemo(() => {
    if (!dialogState) return null;
    return (
      dialogState.seed ??
      (dialogState.index == null
        ? dialogState.definition.createItem()
        : getDesignResumeDialogItem(
            draft,
            dialogState.definition,
            dialogState.index,
          ))
    );
  }, [dialogState, draft]);

  const openImportFile = (target: ImportTarget) => {
    importTargetRef.current = target;
    importFileInputRef.current?.click();
  };

  const handleImportFile = async (file: File) => {
    const { language } = importTargetRef.current;
    try {
      setResumeImporting(true);
      const dataUrl = await fileToDataUrl(file);
      const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());

      if (!match) {
        throw new Error("Resume file could not be encoded for upload.");
      }

      const imported = await api.importDesignResumeFromFile({
        fileName: file.name,
        mediaType: file.type || match[1],
        dataBase64: match[2],
        ...(language ? { language } : {}),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.designResume.all,
      });
      setSaveState("saved");
      // Open the CV that was just imported.
      const next = new URLSearchParams(searchParams);
      if (imported.isPrimary || !imported.language) {
        next.delete("lang");
      } else {
        next.set("lang", imported.language);
      }
      setSearchParams(next, { replace: true });
      toast.success(
        language
          ? `Imported your ${DESIGN_RESUME_LANGUAGE_LABELS[language]} CV.`
          : "Imported your CV.",
      );
      notifyReadyPdfRefresh();
    } catch (importError) {
      showErrorToast(importError, "Failed to import your resume file.");
    } finally {
      setResumeImporting(false);
    }
  };

  const handleExport = async () => {
    try {
      const exported = await api.exportDesignResume(requestedLanguage);
      makeDownload(exported.fileName, exported.document);
      toast.success("Exported your resume JSON.");
    } catch (exportError) {
      showErrorToast(exportError, "Failed to export your CV.");
    }
  };

  const handleDownloadPdf = async () => {
    try {
      setPdfDownloading(true);
      await ensureLatestPersistedDraft();
      const generated = await api.generateDesignResumePdf(requestedLanguage);
      await downloadDesignResumePdf(generated.fileName, generated.pdfUrl);
      toast.success("Your PDF is ready.");
    } catch (downloadError) {
      showErrorToast(downloadError, "Failed to generate a PDF.");
    } finally {
      setPdfDownloading(false);
    }
  };

  const handleDeleteVariant = async () => {
    const language = draft?.language;
    if (!language || draft?.isPrimary) return;
    try {
      await api.deleteDesignResumeVariant(language);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.designResume.all,
      });
      const next = new URLSearchParams(searchParams);
      next.delete("lang");
      setSearchParams(next, { replace: true });
      toast.success(
        `Deleted your ${getDesignResumeLanguageLabel(language)} CV.`,
      );
    } catch (deleteError) {
      showErrorToast(deleteError, "Failed to delete this CV.");
    }
  };

  const handleUploadPicture = async (file: File) => {
    try {
      setPictureUploading(true);
      const latestDraft = await ensureLatestPersistedDraft();
      if (!latestDraft) return;

      const editVersionAtStart = editVersionRef.current;
      const updated = await api.uploadDesignResumePictureFile({
        file,
        baseRevision: latestDraft.revision,
        language: latestDraft.language,
      });
      if (editVersionRef.current === editVersionAtStart) {
        setDesignResume(updated);
      } else {
        setDraft((current) =>
          current
            ? {
                ...updated,
                resumeJson: current.resumeJson,
                aiGuidance: current.aiGuidance,
              }
            : updated,
        );
        setDirty(true);
        setSaveState("idle");
      }
      toast.success("Picture uploaded.");
      notifyReadyPdfRefresh();
    } catch (uploadError) {
      showErrorToast(uploadError, "Failed to upload picture.");
    } finally {
      setPictureUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDeletePicture = async () => {
    try {
      const latestDraft = await ensureLatestPersistedDraft();
      if (!latestDraft) return;

      const editVersionAtStart = editVersionRef.current;
      const updated = await api.deleteDesignResumePicture(
        {
          baseRevision: latestDraft.revision,
          document: latestDraft.resumeJson,
        },
        latestDraft.language,
      );
      if (editVersionRef.current === editVersionAtStart) {
        setDesignResume(updated);
      } else {
        setDraft((current) =>
          current
            ? {
                ...updated,
                resumeJson: current.resumeJson,
                aiGuidance: current.aiGuidance,
              }
            : updated,
        );
        setDirty(true);
        setSaveState("idle");
      }
      toast.success("Picture removed.");
      notifyReadyPdfRefresh();
    } catch (deleteError) {
      showErrorToast(deleteError, "Failed to delete picture.");
    }
  };

  const busy = resumeImporting || switchingVariant;

  const rail = draft ? (
    <DesignResumeRail
      draft={draft}
      onUpdateResumeJson={updateResumeJson}
      onUpdateAiGuidance={updateAiGuidance}
      saveState={saveState}
      isDirty={dirty}
      onOpenDialog={(definition, index) =>
        setDialogState({
          definition,
          index,
          seed:
            index == null
              ? definition.createItem()
              : getDesignResumeDialogItem(draft, definition, index),
        })
      }
      onUploadPicture={() => fileInputRef.current?.click()}
      onDeletePicture={handleDeletePicture}
      pictureUploading={pictureUploading}
    />
  ) : null;

  const currentLanguageLabel = draft?.language
    ? getDesignResumeLanguageLabel(draft.language)
    : null;

  const actionsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9"
          aria-label="More CV actions"
          disabled={busy}
        >
          {resumeImporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MoreHorizontal className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          {currentLanguageLabel ? `${currentLanguageLabel} CV` : "This CV"}
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() =>
            openImportFile({
              language: normalizeDesignResumeLanguage(draft?.language),
            })
          }
          disabled={!draft}
        >
          <FileUp className="mr-2 h-4 w-4" />
          Replace from a file (PDF, DOCX)…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handleExport()} disabled={!draft}>
          <Download className="mr-2 h-4 w-4" />
          Export JSON
        </DropdownMenuItem>
        {missingLanguages.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Languages className="mr-2 h-4 w-4" />
                Add a CV in another language
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {missingLanguages.map((language) => (
                  <DropdownMenuItem
                    key={language}
                    onSelect={() => openImportFile({ language })}
                  >
                    {DESIGN_RESUME_LANGUAGE_LABELS[language]}…
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        ) : null}
        {draft && !draft.isPrimary && draft.language ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-rose-400 focus:text-rose-300"
              onSelect={() => setShowDeleteVariantConfirm(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete this {currentLanguageLabel} CV
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) {
            void handleUploadPicture(file);
          }
        }}
      />
      <input
        ref={importFileInputRef}
        type="file"
        accept={RESUME_FILE_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) {
            void handleImportFile(file);
          }
          event.currentTarget.value = "";
        }}
      />

      <PageHeader
        icon={PenSquare}
        title="Design Resume"
        subtitle="Edit your CV and tell the AI how to use it"
        actions={
          draft ? (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap sm:justify-end">
              <Sheet open={mobileRailOpen} onOpenChange={setMobileRailOpen}>
                <SheetTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 lg:hidden"
                  >
                    <PanelLeft className="mr-1.5 h-4 w-4" />
                    Edit
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="flex w-full max-w-[30rem] flex-col p-0"
                >
                  <SheetHeader className="px-4 pt-4">
                    <SheetTitle>Edit CV</SheetTitle>
                  </SheetHeader>
                  <div className="min-h-0 flex-1">{rail}</div>
                </SheetContent>
              </Sheet>

              <VariantSwitcher
                variants={variants}
                activeId={activeVariant?.id ?? draft.id}
                disabled={busy}
                onSelect={(variant) => void selectVariant(variant)}
              />

              <Button
                type="button"
                size="sm"
                className="h-9"
                onClick={handleDownloadPdf}
                disabled={!canDownloadPdf}
              >
                {pdfDownloading ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="mr-1.5 h-4 w-4" />
                )}
                {pdfDownloading ? "Preparing…" : "Download PDF"}
              </Button>

              {actionsMenu}
            </div>
          ) : null
        }
      />

      <PageMain className="h-[calc(100dvh-11.5rem)] overflow-hidden lg:h-[calc(100dvh-7.5rem)]">
        {isLoading ? (
          <div className="grid h-full gap-6 lg:grid-cols-[400px_minmax(0,1fr)] xl:grid-cols-[480px_minmax(0,1fr)]">
            <div className="hidden animate-pulse rounded-2xl border border-border/70 bg-muted/20 lg:block" />
            <div className="animate-pulse rounded-2xl border border-border/70 bg-muted/20" />
          </div>
        ) : !draft ? (
          <div className="flex h-full items-center justify-center rounded-2xl border border-border/70 bg-background/95 px-6 py-20 text-center">
            <div className="mx-auto max-w-xl space-y-5">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                {requestedLanguage
                  ? `No ${DESIGN_RESUME_LANGUAGE_LABELS[requestedLanguage]} CV yet`
                  : "Import your CV to start editing it here"}
              </h2>
              <p className="text-sm leading-7 text-muted-foreground">
                Upload your CV as a PDF or Word file. Boussole turns it into an
                editable CV you can refine, preview, and let the AI tailor for
                each job — with your rules.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Button
                  type="button"
                  onClick={() =>
                    openImportFile({ language: requestedLanguage })
                  }
                  disabled={resumeImporting}
                >
                  {resumeImporting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileUp className="mr-2 h-4 w-4" />
                  )}
                  {resumeImporting ? "Importing…" : "Upload a CV file"}
                </Button>
                {requestedLanguage ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const next = new URLSearchParams(searchParams);
                      next.delete("lang");
                      setSearchParams(next, { replace: true });
                    }}
                  >
                    Back to my default CV
                  </Button>
                ) : null}
              </div>
              {error && !requestedLanguage ? (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">
                  {formatUserFacingError(error, "Unable to load your CV.")}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="grid h-full min-h-0 gap-6 lg:grid-cols-[400px_minmax(0,1fr)] xl:grid-cols-[480px_minmax(0,1fr)]">
            <aside className="hidden min-h-0 overflow-hidden rounded-2xl border border-border/70 bg-muted/20 lg:block">
              {rail}
            </aside>

            <DesignResumePreviewPanel
              draft={draft}
              language={requestedLanguage}
              isDirty={dirty}
              saveState={saveState}
            />
          </div>
        )}
      </PageMain>

      {dialogState && draft ? (
        <ItemDialog
          open={Boolean(dialogState)}
          title={`${dialogState.index == null ? "Add" : "Edit"} ${dialogState.definition.singularTitle}`}
          description={dialogState.definition.description}
          item={activeDialogItem}
          fields={dialogState.definition.fields}
          onOpenChange={(open) => {
            if (!open) setDialogState(null);
          }}
          onSave={(item) => {
            updateResumeJson((current) => {
              const next = structuredClone(current);
              const sections = (asRecord(next.sections) ?? {}) as Record<
                string,
                unknown
              >;
              const section = (asRecord(sections[dialogState.definition.key]) ??
                {}) as Record<string, unknown>;
              const items = asArray(section.items).map(
                (entry) => asRecord(entry) ?? {},
              ) as Record<string, unknown>[];
              const nextItems =
                dialogState.index == null
                  ? [...items, item]
                  : items.map((entry, index) =>
                      index === dialogState.index ? item : entry,
                    );
              next.sections = {
                ...sections,
                [dialogState.definition.key]: {
                  ...section,
                  // Ensure the edited section is visible in rendered output.
                  hidden: false,
                  items: nextItems,
                },
              } as DesignResumeJson["sections"];
              return next;
            });
          }}
          onDelete={
            dialogState.index == null
              ? undefined
              : () => {
                  updateResumeJson((current) => {
                    const next = structuredClone(current);
                    const sections = (asRecord(next.sections) ?? {}) as Record<
                      string,
                      unknown
                    >;
                    const section = (asRecord(
                      sections[dialogState.definition.key],
                    ) ?? {}) as Record<string, unknown>;
                    const items = asArray(section.items).filter(
                      (_, index) => index !== dialogState.index,
                    );
                    next.sections = {
                      ...sections,
                      [dialogState.definition.key]: {
                        ...section,
                        // Keep section visible after inline list edits.
                        hidden: false,
                        items,
                      },
                    } as DesignResumeJson["sections"];
                    return next;
                  });
                  setDialogState(null);
                }
          }
        />
      ) : null}

      <AlertDialog
        open={showDeleteVariantConfirm}
        onOpenChange={setShowDeleteVariantConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete your {currentLanguageLabel} CV?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Jobs posted in this language will use your default CV instead.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setShowDeleteVariantConfirm(false);
                void handleDeleteVariant();
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
