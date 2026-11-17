import * as api from "@client/api";
import type { DesignResumeDocument, PdfRenderer } from "@shared/types";
import { FileText, Loader2 } from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * pdf.js is ~1 MB, so it is loaded on demand (its own chunk) the first time a
 * preview renders instead of being part of every page's bundle. Rendering to
 * a canvas (instead of an <object>/<iframe>) means no browser PDF viewer is
 * involved, so the page is always fully visible, centered, and never cropped.
 */
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import("pdfjs-dist"),
      // Vite emits the worker as a hashed asset (documented pdfjs v4 setup).
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ])
      .then(([pdfjs, worker]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        return pdfjs;
      })
      .catch((error: unknown) => {
        pdfjsPromise = null; // allow a retry after a failed chunk load
        throw error;
      });
  }
  return pdfjsPromise;
}

type DesignResumePdfPreviewProps = {
  draft: DesignResumeDocument;
  /** CV variant to render (e.g. "en"); null → the primary CV. */
  language?: string | null;
  pdfRenderer: PdfRenderer;
  isUpdatingRenderer: boolean;
  isDirty: boolean;
  saveState: "idle" | "saving" | "saved" | "error";
};

type PreviewState = "idle" | "waiting-for-save" | "loading" | "ready" | "error";

export function DesignResumePdfPreview({
  draft,
  language = null,
  pdfRenderer,
  isUpdatingRenderer,
  isDirty,
  saveState,
}: DesignResumePdfPreviewProps) {
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  // The id of the CV whose page is currently drawn; a different CV (variant
  // switch) shows a page skeleton instead of the previous CV's page.
  const [drawnDocumentId, setDrawnDocumentId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const requestSequence = useRef(0);
  const lastLoadedKey = useRef<string | null>(null);
  // Keep the latest first page around so a container resize can re-fit it
  // without re-fetching/re-parsing the PDF.
  const pageRef = useRef<PDFPageProxy | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const revisionKey = useMemo(
    () => `${draft.id}:${draft.revision}:${pdfRenderer}:${language ?? ""}`,
    [draft.id, draft.revision, pdfRenderer, language],
  );

  // Draw the cached first page into the canvas, scaled to "contain" within the
  // frame (fits width AND height, centered). Never crops.
  const drawPage = useCallback((page: PDFPageProxy) => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;

    const frameWidth = frame.clientWidth;
    const frameHeight = frame.clientHeight;
    if (frameWidth <= 0 || frameHeight <= 0) return;

    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(frameWidth / base.width, frameHeight / base.height);
    const viewport = page.getViewport({ scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const context = canvas.getContext("2d");
    if (!context) return;

    renderTaskRef.current?.cancel();
    const task = page.render({
      canvasContext: context,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    });
    renderTaskRef.current = task;
    task.promise.catch((error: unknown) => {
      // RenderingCancelledException is expected when a resize/reload supersedes
      // an in-flight render — ignore it.
      if (
        error &&
        typeof error === "object" &&
        (error as { name?: string }).name === "RenderingCancelledException"
      ) {
        return;
      }
      throw error;
    });
  }, []);

  useEffect(() => {
    if (saveState === "error") {
      setIsRendering(false);
      setPreviewState((current) =>
        current === "waiting-for-save" ? "error" : current,
      );
      setPreviewError("Changes could not be saved. Please try again.");
      return;
    }

    if (isUpdatingRenderer || isDirty || saveState === "saving") {
      setPreviewState("waiting-for-save");
      setIsRendering(false);
      return;
    }

    if (lastLoadedKey.current === revisionKey) {
      return;
    }

    const requestId = ++requestSequence.current;
    lastLoadedKey.current = revisionKey;
    setPreviewState("loading");
    setPreviewError(null);
    setIsRendering(true);

    const documentId = draft.id;
    void api
      .generateDesignResumePdf(language)
      .then(async (generated) => {
        const blob = await api.getDesignResumePdfBlob(generated.pdfUrl);
        const data = new Uint8Array(await blob.arrayBuffer());
        const pdfjs = await loadPdfJs();
        return pdfjs.getDocument({ data }).promise;
      })
      .then(async (pdf) => {
        if (requestSequence.current !== requestId) {
          await pdf.destroy();
          return;
        }
        docRef.current?.destroy();
        docRef.current = pdf;
        const page = await pdf.getPage(1);
        if (requestSequence.current !== requestId) return;
        pageRef.current = page;
        drawPage(page);
        setDrawnDocumentId(documentId);
        setPreviewState("ready");
        setIsRendering(false);
      })
      .catch((error: unknown) => {
        if (requestSequence.current !== requestId) return;
        lastLoadedKey.current = null;
        setPreviewError(
          error instanceof Error
            ? error.message
            : "Could not render the PDF preview.",
        );
        setPreviewState("error");
        setIsRendering(false);
      });
  }, [
    draft.id,
    isDirty,
    isUpdatingRenderer,
    language,
    revisionKey,
    saveState,
    drawPage,
  ]);

  // Re-fit the already-loaded page when the preview pane resizes.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pageRef.current) drawPage(pageRef.current);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [drawPage]);

  useEffect(() => {
    return () => {
      renderTaskRef.current?.cancel();
      docRef.current?.destroy();
    };
  }, []);

  const showLoader =
    previewState === "loading" ||
    previewState === "waiting-for-save" ||
    isRendering;
  const hasPage = drawnDocumentId === draft.id;
  const loaderLabel = isUpdatingRenderer
    ? "Switching template…"
    : previewState === "waiting-for-save"
      ? "Saving changes…"
      : "Rendering preview…";

  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-hidden bg-muted/10 p-6 xl:p-8">
      <div
        ref={frameRef}
        className="relative flex h-full w-full items-center justify-center"
      >
        <canvas
          ref={canvasRef}
          aria-label="CV PDF preview"
          className={cn(
            "max-h-full max-w-full rounded-sm bg-white shadow-[0_24px_80px_rgba(0,0,0,0.28)] ring-1 ring-black/10 transition-opacity duration-200",
            !hasPage && "hidden",
            hasPage && showLoader && "opacity-70",
          )}
        />

        {!hasPage && previewState !== "error" ? (
          <div
            aria-hidden="true"
            className="aspect-[210/297] h-full max-h-full max-w-full animate-pulse rounded-sm bg-white/[0.04] ring-1 ring-border/60"
          />
        ) : null}

        {showLoader ? (
          <output className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border/70 bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            {loaderLabel}
          </output>
        ) : null}

        {previewState === "error" ? (
          <div className="absolute inset-0 grid place-items-center bg-background/80">
            <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-6 py-5 text-center">
              <FileText className="h-6 w-6 text-rose-300" />
              <div className="text-sm font-medium text-rose-200">
                Preview unavailable
              </div>
              <div className="text-xs leading-6 text-rose-200/80">
                {previewError ?? "Could not render the PDF preview."}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
