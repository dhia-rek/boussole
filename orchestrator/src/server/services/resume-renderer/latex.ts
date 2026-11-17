import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { JAKE_BOLD_END, JAKE_BOLD_START } from "@shared/design-resume-jake";
import { getLatexResumeSectionTitles } from "./document";
import type {
  LatexResumeContactItem,
  LatexResumeDocument,
  LatexResumeEntry,
  ResumeRenderer,
} from "./types";

function resolveTemplatePath(): string {
  try {
    if (import.meta.url.startsWith("file:")) {
      const modulePath = fileURLToPath(import.meta.url);
      const moduleRelativePath = join(
        modulePath,
        "..",
        "templates",
        "jake-resume.tex",
      );
      if (existsSync(moduleRelativePath)) {
        return moduleRelativePath;
      }
    }
  } catch {
    // Fall through to cwd-based resolution below.
  }

  const cwd = process.cwd();
  if (cwd.endsWith("/orchestrator")) {
    return join(
      cwd,
      "src/server/services/resume-renderer/templates/jake-resume.tex",
    );
  }
  return join(
    cwd,
    "orchestrator/src/server/services/resume-renderer/templates/jake-resume.tex",
  );
}

const TEMPLATE_PATH = resolveTemplatePath();
const TECTONIC_TIMEOUT_MS = 120_000;

/** Bold runs from the CV arrive wrapped in these markers (see design-resume-jake). */
const BOLD_RUN = new RegExp(
  `${JAKE_BOLD_START}([^${JAKE_BOLD_START}${JAKE_BOLD_END}]*)${JAKE_BOLD_END}`,
  "g",
);
const BOLD_MARKERS = new RegExp(`[${JAKE_BOLD_START}${JAKE_BOLD_END}]`, "g");

function normalizeText(value: string): string {
  return (
    value
      // Typographic dashes → TeX ligatures (en dash "--", em dash "---").
      .replace(/\u2014/g, "---")
      .replace(/\u2013/g, "--")
      .replace(/\u2010|\u2011|\u2012/g, "-")
      .replace(/\u2022/g, "-")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function escapeLatexText(value: string): string {
  return normalizeText(value)
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function escapeLatexUrl(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function escapeKeepingBold(value: string): string {
  return escapeLatexText(value).replace(/\|/g, "{\\textbar}");
}

function escapeForCommand(value: string): string {
  return escapeKeepingBold(value).replace(BOLD_MARKERS, "");
}

/** Escapes text and restores bold runs from the CV as `\textbf{…}`. */
function renderRichText(value: string): string {
  return escapeKeepingBold(value)
    .replace(BOLD_RUN, (_match, inner: string) =>
      inner.trim() ? `\\textbf{${inner}}` : inner,
    )
    .replace(BOLD_MARKERS, "");
}

function renderLink(label: string, url?: string | null): string {
  if (!url) return escapeForCommand(label);
  return `\\href{${escapeLatexUrl(url)}}{\\underline{${escapeForCommand(label)}}}`;
}

/** Editor icon names (Phosphor/Iconify style) → FontAwesome 4 commands. */
const NAMED_CONTACT_ICONS: Array<[RegExp, string]> = [
  [/calendar|date|clock/, "\\faCalendar"],
  [/map|pin|location|home|house|address/, "\\faMapMarker"],
  [/phone|mobile/, "\\faPhone"],
  [/envelope|mail|email/, "\\faEnvelope"],
  [/linkedin/, "\\faLinkedin"],
  [/github/, "\\faGithub"],
  [/briefcase|work|job/, "\\faBriefcase"],
  [/graduation|school|student/, "\\faGraduationCap"],
  [/car|driving/, "\\faCar"],
  [/globe|web|link|site/, "\\faGlobe"],
];

/** Uses the icon chosen in the editor when it is recognised; otherwise infers
 *  one from the contact value (email/phone/social/site). */
function contactIcon(item: LatexResumeContactItem): string {
  const named = item.icon?.trim().toLowerCase();
  if (named) {
    const match = NAMED_CONTACT_ICONS.find(([pattern]) => pattern.test(named));
    if (match) return match[1];
  }
  const hay = `${item.text} ${item.url ?? ""}`.toLowerCase();
  if (hay.includes("@") && !hay.includes("http")) return "\\faEnvelope";
  if (/^[+\d][\d\s().-]{5,}$/.test(item.text.trim())) return "\\faPhone";
  if (hay.includes("linkedin.")) return "\\faLinkedin";
  if (hay.includes("github.")) return "\\faGithub";
  if (hay.includes("@")) return "\\faEnvelope";
  return "\\faGlobe";
}

function renderContactItems(items: LatexResumeContactItem[]): string {
  return items
    .map((item) => `${contactIcon(item)}\\ ${renderLink(item.text, item.url)}`)
    .join(" \\quad ");
}

function renderBullets(items: string[]): string {
  if (items.length === 0) return "";
  return [
    "      \\resumeItemListStart",
    ...items.map((item) => `        \\resumeItem{${renderRichText(item)}}`),
    "      \\resumeItemListEnd",
  ].join("\n");
}

function renderSubheadingEntry(entry: LatexResumeEntry): string {
  const title = renderLink(entry.title, entry.url);
  const subtitle = entry.subtitle ? escapeForCommand(entry.subtitle) : "";
  const secondaryTitle = entry.secondaryTitle
    ? escapeForCommand(entry.secondaryTitle)
    : "";
  const secondarySubtitle = entry.secondarySubtitle
    ? escapeForCommand(entry.secondarySubtitle)
    : "";
  const date = entry.date ? escapeForCommand(entry.date) : "";

  const lines = [
    "    \\resumeSubheading",
    `      {${title}}{${date}}`,
    `      {${subtitle || secondaryTitle}}{${secondarySubtitle || ""}}`,
  ];

  const bullets = renderBullets(entry.bullets);
  if (bullets) lines.push(bullets);
  return lines.join("\n");
}

function renderProjectEntry(entry: LatexResumeEntry): string {
  const title = renderLink(entry.title, entry.url);
  const subtitle = entry.subtitle
    ? ` $|$ \\emph{${escapeForCommand(entry.subtitle)}}`
    : "";
  const date = entry.date ? escapeForCommand(entry.date) : "";
  const lines = [
    "      \\resumeProjectHeading",
    `          {\\textbf{${title}}${subtitle}}{${date}}`,
  ];
  const bullets = renderBullets(entry.bullets);
  if (bullets) lines.push(bullets);
  return lines.join("\n");
}

function renderSummarySection(document: LatexResumeDocument): string {
  if (!document.summary) return "";
  const titles = document.sectionTitles ?? getLatexResumeSectionTitles();
  return [
    `\\section{${escapeForCommand(titles.summary)}}`,
    " \\begin{itemize}[leftmargin=0.15in, label={}]",
    `    \\small{\\item{${renderRichText(document.summary)}}}`,
    " \\end{itemize}",
    "",
  ].join("\n");
}

function renderEntrySection(args: {
  title: string;
  entries: LatexResumeEntry[];
  kind: "subheading" | "project";
}): string {
  if (args.entries.length === 0) return "";
  const body = args.entries
    .map((entry) =>
      args.kind === "project"
        ? renderProjectEntry(entry)
        : renderSubheadingEntry(entry),
    )
    .join("\n\n");
  return [
    `\\section{${escapeForCommand(args.title)}}`,
    "  \\resumeSubHeadingListStart",
    body,
    "  \\resumeSubHeadingListEnd",
    "",
  ].join("\n");
}

function renderSkillsSection(document: LatexResumeDocument): string {
  if (document.skillGroups.length === 0) return "";
  const titles = document.sectionTitles ?? getLatexResumeSectionTitles();
  const items = document.skillGroups
    .map((group) => {
      const keywords = group.keywords.map((keyword) =>
        escapeForCommand(keyword),
      );
      const keywordsText = keywords.join(", ");
      return `     \\textbf{${escapeForCommand(group.name)}}{: ${keywordsText}} \\\\`;
    })
    .join("\n");
  return [
    `\\section{${escapeForCommand(titles.skills)}}`,
    " \\begin{itemize}[leftmargin=0.15in, label={}]",
    "    \\small{\\item{",
    items,
    "    }}",
    " \\end{itemize}",
    "",
  ].join("\n");
}

function formatExtraEntry(entry: LatexResumeEntry): string {
  const meta = [entry.subtitle, entry.date]
    .map((v) => (v ? v.trim() : ""))
    .filter(Boolean)
    .join(", ");
  const base = escapeForCommand(entry.title);
  return meta ? `${base} (${escapeForCommand(meta)})` : base;
}

/**
 * Certifications + a combined "Other" section, matching the user's own CV:
 *  - Certifications: a single inline pipe-separated line
 *  - "Other": bold-labelled lines (Volunteering / Awards / Languages /
 *    Interests …) instead of separate sparse sections
 */
function renderCertificationsAndOther(document: LatexResumeDocument): string {
  const sections = document.extraSections ?? [];
  const out: string[] = [];

  const titles = document.sectionTitles ?? getLatexResumeSectionTitles();
  const certs = sections.find(
    (s) =>
      s.kind === "certifications" ||
      (!s.kind && s.title.toLowerCase().startsWith("certification")),
  );
  if (certs && certs.entries.length > 0) {
    const inline = certs.entries.map(formatExtraEntry).join(" \\;$|$\\; ");
    out.push(
      [
        `\\section{${escapeForCommand(certs.title || titles.certifications)}}`,
        " \\begin{itemize}[leftmargin=0.15in, label={}]",
        `    \\small{\\item{ ${inline} }}`,
        " \\end{itemize}",
        "",
      ].join("\n"),
    );
  }

  const otherLines: string[] = [];
  for (const section of sections) {
    if (section === certs || section.entries.length === 0) continue;
    const value = section.entries.map(formatExtraEntry).join(", ");
    otherLines.push(
      `    \\textbf{${escapeForCommand(section.title)}}{ : ${value}} \\\\`,
    );
  }
  if ((document.languages ?? []).length > 0) {
    otherLines.push(
      `    \\textbf{${escapeForCommand(titles.languages)}}{ : ${(
        document.languages ?? []
      )
        .map((l) => escapeForCommand(l))
        .join(", ")}} \\\\`,
    );
  }
  if ((document.interests ?? []).length > 0) {
    otherLines.push(
      `    \\textbf{${escapeForCommand(titles.interests)}}{ : ${(
        document.interests ?? []
      )
        .map((i) => escapeForCommand(i))
        .join(", ")}}`,
    );
  }
  if (otherLines.length > 0) {
    out.push(
      [
        `\\section{${escapeForCommand(titles.other)}}`,
        " \\begin{itemize}[leftmargin=0.15in, label={}]",
        "    \\small{\\item{",
        otherLines.join("\n"),
        "    }}",
        " \\end{itemize}",
        "",
      ].join("\n"),
    );
  }

  return out.join("\n");
}

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
  options: { fitLevel?: number } = {},
): string {
  const titles = document.sectionTitles ?? getLatexResumeSectionTitles();
  const headlineBlock = document.headline
    ? `    \\small ${escapeForCommand(document.headline)} \\\\ \\vspace{1pt}\n`
    : "";
  // Text-only custom fields (e.g. availability) read as a tagline under the
  // headline; real contact details and links stay on the contact line.
  const taglineItems = document.contactItems.filter(
    (item) => item.kind === "custom" && !item.url,
  );
  const contactItems = document.contactItems.filter(
    (item) => !taglineItems.includes(item),
  );
  const taglineBlock =
    taglineItems.length > 0
      ? `    \\small ${renderContactItems(taglineItems)} \\\\ \\vspace{2pt}\n`
      : "";
  const contactBlock =
    contactItems.length > 0
      ? `    \\small ${renderContactItems(contactItems)}\n`
      : "";
  const body = [
    renderSummarySection(document),
    renderEntrySection({
      title: titles.experience,
      entries: document.experience,
      kind: "subheading",
    }),
    renderEntrySection({
      title: titles.education,
      entries: document.education,
      kind: "subheading",
    }),
    renderEntrySection({
      title: titles.projects,
      entries: document.projects,
      kind: "project",
    }),
    renderSkillsSection(document),
    renderCertificationsAndOther(document),
  ]
    .filter(Boolean)
    .join("\n");

  return template
    .replace("__FIT__", LATEX_FIT_LEVELS[options.fitLevel ?? 0] ?? "")
    .replace("__NAME__", escapeForCommand(document.name))
    .replace("__HEADLINE_BLOCK__", `${headlineBlock}${taglineBlock}`)
    .replace("__CONTACT_BLOCK__", contactBlock)
    .replace("__BODY__", body);
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

export const latexResumeRenderer: ResumeRenderer = {
  async render({ document, outputPath, jobId }) {
    const tempDir = await mkdtemp(
      join(tmpdir(), `boussole-resume-render-${jobId}-`),
    );

    try {
      const template = await loadTemplate();
      const compile = async (fitLevel: number) => {
        const stem = `resume-fit${fitLevel}`;
        const texPath = join(tempDir, `${stem}.tex`);
        await writeFile(
          texPath,
          buildLatexDocument(document, template, { fitLevel }),
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
