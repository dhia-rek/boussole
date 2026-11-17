import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { buildResumeLatex } from "./layout";
import type { LatexResumeDocument, ResumeRenderer } from "./types";

const TEMPLATE_FILE = "resume.tex";

function resolveTemplatePath(fileName: string): string {
  try {
    if (import.meta.url.startsWith("file:")) {
      const modulePath = fileURLToPath(import.meta.url);
      const moduleRelativePath = join(modulePath, "..", "templates", fileName);
      if (existsSync(moduleRelativePath)) {
        return moduleRelativePath;
      }
    }
  } catch {
    // Fall through to cwd-based resolution below.
  }

  const cwd = process.cwd();
  if (cwd.endsWith("/orchestrator")) {
    return join(cwd, "src/server/services/resume-renderer/templates", fileName);
  }
  return join(
    cwd,
    "orchestrator/src/server/services/resume-renderer/templates",
    fileName,
  );
}

const TEMPLATE_PATH = resolveTemplatePath(TEMPLATE_FILE);

/** Image types Tectonic can embed in the header. */
const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".pdf"]);
const TECTONIC_TIMEOUT_MS = 120_000;

async function loadTemplate(): Promise<string> {
  return await readFile(TEMPLATE_PATH, "utf8");
}

/**
 * Preamble snippets for one-page auto-fit, from untouched (0) to tightest (3).
 * Each level only tightens line/list/section spacing and margins slightly —
 * never the font size — so the CV keeps its look.
 */
const LIST_TIGHTENING = [
  "\\renewcommand{\\resumeItemListStart}{\\begin{itemize}[itemsep=0pt, parsep=0pt, topsep=1pt, partopsep=0pt, leftmargin=*]}",
  "\\renewcommand{\\resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=0.15in, label={}, itemsep=1pt, parsep=0pt, topsep=2pt, partopsep=0pt]}",
];

export const LATEX_FIT_LEVELS: readonly string[] = [
  "",
  ["\\geometry{top=0.35in,bottom=0.32in}", "\\linespread{0.97}"].join("\n"),
  [
    "\\geometry{top=0.3in,bottom=0.28in,left=0.4in,right=0.4in}",
    "\\linespread{0.95}",
    ...LIST_TIGHTENING,
    "\\titlespacing*{\\section}{0pt}{2.6ex}{2.3ex}",
  ].join("\n"),
  [
    "\\geometry{top=0.28in,bottom=0.25in,left=0.38in,right=0.38in}",
    "\\linespread{0.92}",
    ...LIST_TIGHTENING,
    "\\titlespacing*{\\section}{0pt}{2.2ex}{2.2ex}",
  ].join("\n"),
];

type FitAttempt<T> = T & { fitLevel: number; pages: number };

/**
 * One-page auto-fit strategy. A CV that barely spills onto page 2 is
 * re-rendered with progressively tighter spacing; the tightest level is probed
 * first so a genuinely multi-page CV costs a single extra compile, and the
 * gentlest level that fits wins. CVs of 3+ pages are left untouched.
 */
export async function selectFitLevel<T>(
  compile: (fitLevel: number) => Promise<FitAttempt<T>>,
  levelCount = LATEX_FIT_LEVELS.length,
): Promise<FitAttempt<T>> {
  const untouched = await compile(0);
  if (untouched.pages !== 2 || levelCount < 2) return untouched;

  const tightest = await compile(levelCount - 1);
  if (tightest.pages !== 1) return untouched;

  for (let level = 1; level < levelCount - 1; level++) {
    const attempt = await compile(level);
    if (attempt.pages === 1) return attempt;
  }
  return tightest;
}

/** Page count from a TeX log ("Output written on x.xdv (2 pages, …)"). */
export function parseLatexPageCount(log: string): number {
  const match = /Output written on [^\n]*?\((\d+) pages?/.exec(log);
  const pages = match ? Number.parseInt(match[1] ?? "", 10) : Number.NaN;
  return Number.isFinite(pages) && pages > 0 ? pages : 1;
}

export function buildLatexDocument(
  document: LatexResumeDocument,
  template: string,
  options: {
    fitLevel?: number;
    /** File name of the header photo inside the compile directory. */
    photoFileName?: string | null;
  } = {},
): string {
  return buildResumeLatex(document, template, {
    fitSnippet: LATEX_FIT_LEVELS[options.fitLevel ?? 0] ?? "",
    photoFileName: options.photoFileName ?? null,
  });
}

function truncateOutput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 1200) return trimmed;
  return `${trimmed.slice(0, 1200)}…(truncated ${trimmed.length - 1200} chars)`;
}

async function runTectonic(args: {
  cwd: string;
  texPath: string;
  jobId: string;
}): Promise<void> {
  const binary = process.env.TECTONIC_BIN?.trim() || "tectonic";

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      binary,
      ["--keep-logs", "--outdir", args.cwd, args.texPath],
      {
        cwd: args.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new Error(
          `Tectonic timed out after ${TECTONIC_TIMEOUT_MS / 1000}s while rendering resume PDF.`,
        ),
      );
    }, TECTONIC_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            `Tectonic binary not found. Install tectonic or set TECTONIC_BIN to the executable path.`,
          ),
        );
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Tectonic failed with exit code ${code ?? "unknown"}. ${truncateOutput(stderr || stdout)}`,
        ),
      );
    });
  }).catch((error) => {
    logger.warn("LaTeX resume compile failed", {
      jobId: args.jobId,
      error,
      compiler: binary,
    });
    throw error;
  });
}

/** Copies the header photo next to the .tex file; null when unusable. */
async function stagePhoto(
  photoPath: string | null | undefined,
  tempDir: string,
  jobId: string,
): Promise<string | null> {
  if (!photoPath) return null;
  const extension = extname(photoPath).toLowerCase();
  if (!PHOTO_EXTENSIONS.has(extension) || !existsSync(photoPath)) {
    logger.warn("CV photo skipped: missing file or unsupported type", {
      jobId,
      extension,
    });
    return null;
  }
  const fileName = `photo${extension === ".jpeg" ? ".jpg" : extension}`;
  await copyFile(photoPath, join(tempDir, fileName));
  return fileName;
}

export const latexResumeRenderer: ResumeRenderer = {
  async render({ document, outputPath, jobId }) {
    const tempDir = await mkdtemp(
      join(tmpdir(), `forsa-resume-render-${jobId}-`),
    );

    try {
      const template = await loadTemplate();
      const photoFileName = await stagePhoto(
        document.photoPath,
        tempDir,
        jobId,
      );
      const compile = async (fitLevel: number) => {
        const stem = `resume-fit${fitLevel}`;
        const texPath = join(tempDir, `${stem}.tex`);
        await writeFile(
          texPath,
          buildLatexDocument(document, template, { fitLevel, photoFileName }),
          "utf8",
        );
        await runTectonic({ cwd: tempDir, texPath, jobId });
        const log = await readFile(join(tempDir, `${stem}.log`), "utf8").catch(
          () => "",
        );
        return {
          fitLevel,
          pdfPath: join(tempDir, `${stem}.pdf`),
          pages: parseLatexPageCount(log),
        };
      };

      const chosen = await selectFitLevel(compile);
      await copyFile(chosen.pdfPath, outputPath);

      logger.info("Rendered LaTeX resume PDF", {
        jobId,
        outputPath,
        withPhoto: Boolean(photoFileName),
        pages: chosen.pages,
        fitLevel: chosen.fitLevel,
      });
    } catch (error) {
      logger.error("Failed to render LaTeX resume PDF", {
        jobId,
        outputPath,
        error,
        document: sanitizeUnknown({
          name: document.name,
          headline: document.headline,
          experienceCount: document.experience.length,
          educationCount: document.education.length,
          projectCount: document.projects.length,
          skillGroupCount: document.skillGroups.length,
        }),
      });
      throw error;
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(
        (cleanupError) => {
          logger.warn("Failed to cleanup temporary LaTeX render directory", {
            jobId,
            tempDir,
            error: cleanupError,
          });
        },
      );
    }
  },
};

export async function renderLatexPdf(args: {
  document: LatexResumeDocument;
  outputPath: string;
  jobId: string;
}): Promise<void> {
  await latexResumeRenderer.render(args);
}

export function getLatexTemplatePath(): string {
  return TEMPLATE_PATH;
}

export function getTectonicBinary(): string {
  return process.env.TECTONIC_BIN?.trim() || "tectonic";
}

export async function readLatexTemplate(): Promise<string> {
  return await loadTemplate();
}
