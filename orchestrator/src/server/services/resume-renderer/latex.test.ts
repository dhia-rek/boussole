import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getLatexResumeSectionTitles } from "./document";
import {
  buildLatexDocument,
  getLatexTemplatePath,
  getTectonicBinary,
  LATEX_FIT_LEVELS,
  parseLatexPageCount,
  readLatexTemplate,
  renderLatexPdf,
  selectFitLevel,
} from "./latex";
import type { LatexResumeDocument } from "./types";

const baseDocument: LatexResumeDocument = {
  name: "Jane Doe",
  headline: "Senior Software Engineer",
  contactItems: [
    { text: "jane@example.com", url: "mailto:jane@example.com" },
    { text: "Portfolio", url: "https://jane.dev" },
  ],
  summary: "Builds resilient platform systems.",
  experience: [
    {
      title: "Acme",
      subtitle: "Platform Engineer | Remote",
      date: "2023 -- Present",
      bullets: ["Improved API reliability", "Reduced operator toil"],
      url: "https://acme.example.com",
      linkLabel: "Acme",
    },
  ],
  education: [],
  projects: [],
  skillGroups: [
    {
      name: "Backend",
      keywords: ["TypeScript", "Node.js", "PostgreSQL"],
    },
  ],
};

async function createTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "boussole-latex-render-test-"));
}

function tectonicAvailable(): boolean {
  const binary = process.env.TECTONIC_BIN?.trim() || "tectonic";
  const result = spawnSync(binary, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

describe("latex resume renderer", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it("exposes the bundled Jake template", async () => {
    expect(getLatexTemplatePath()).toContain("jake-resume.tex");
    const template = await readLatexTemplate();
    expect(template).toContain("Resume in Latex");
    expect(template).toContain("__BODY__");
  });

  it("uses the TECTONIC_BIN override when present", () => {
    const previous = process.env.TECTONIC_BIN;
    process.env.TECTONIC_BIN = "/tmp/custom-tectonic";
    expect(getTectonicBinary()).toBe("/tmp/custom-tectonic");
    if (previous === undefined) {
      delete process.env.TECTONIC_BIN;
    } else {
      process.env.TECTONIC_BIN = previous;
    }
  });

  it("defaults LaTeX section titles to English", () => {
    const latex = buildLatexDocument(
      {
        ...baseDocument,
        sectionTitles: undefined,
      },
      "__NAME__\n__HEADLINE_BLOCK__\n__CONTACT_BLOCK__\n__BODY__",
    );

    expect(latex).toContain("\\section{Summary}");
    expect(latex).toContain("\\section{Experience}");
    expect(latex).toContain("\\section{Technical Skills}");
  });

  it("renders localized LaTeX section titles", () => {
    const latex = buildLatexDocument(
      {
        ...baseDocument,
        education: [
          {
            title: "University",
            subtitle: "MSc",
            date: "2020",
            bullets: ["Studied distributed systems"],
          },
        ],
        projects: [
          {
            title: "Platform",
            subtitle: "TypeScript",
            date: "2024",
            bullets: ["Built deployment tooling"],
          },
        ],
        sectionTitles: {
          summary: "Resumen",
          experience: "Experiencia",
          education: "Educación",
          projects: "Proyectos",
          skills: "Habilidades técnicas",
          certifications: "Certificaciones",
          awards: "Premios",
          publications: "Publicaciones",
          volunteer: "Voluntariado",
          languages: "Idiomas",
          interests: "Intereses",
          other: "Otros",
        },
      },
      "__NAME__\n__HEADLINE_BLOCK__\n__CONTACT_BLOCK__\n__BODY__",
    );

    expect(latex).toContain("\\section{Resumen}");
    expect(latex).toContain("\\section{Experiencia}");
    expect(latex).toContain("\\section{Educación}");
    expect(latex).toContain("\\section{Proyectos}");
    expect(latex).toContain("\\section{Habilidades técnicas}");
  });

  it("fails with a helpful error when tectonic is unavailable", async () => {
    const previous = process.env.TECTONIC_BIN;
    process.env.TECTONIC_BIN = "/definitely/missing/tectonic";
    const tempDir = await createTempDir();
    tempDirs.push(tempDir);
    const outputPath = join(tempDir, "resume.pdf");

    await expect(
      renderLatexPdf({
        document: baseDocument,
        outputPath,
        jobId: "job-missing-tectonic",
      }),
    ).rejects.toThrow(/Tectonic binary not found/i);

    if (previous === undefined) {
      delete process.env.TECTONIC_BIN;
    } else {
      process.env.TECTONIC_BIN = previous;
    }
  });

  it.skipIf(!tectonicAvailable())(
    "renders a PDF when tectonic is installed",
    async () => {
      const tempDir = await createTempDir();
      tempDirs.push(tempDir);
      const outputPath = join(tempDir, "resume.pdf");

      await renderLatexPdf({
        document: baseDocument,
        outputPath,
        jobId: "job-render-success",
      });

      const stats = spawnSync("sh", ["-lc", `test -s "${outputPath}"`], {
        stdio: "ignore",
      });
      expect(stats.status).toBe(0);
    },
  );

  describe("formatting fidelity", () => {
    const template =
      "__FIT__|__NAME__\n__HEADLINE_BLOCK____CONTACT_BLOCK__\n__BODY__";

    it("renders bold runs from the CV as \\textbf and escapes the rest", () => {
      const latex = buildLatexDocument(
        {
          ...baseDocument,
          summary: "Built \u0001RAG & agents\u0002 at 100%",
          experience: [
            {
              title: "KPIT",
              date: "09/2024 \u2013 02/2026",
              bullets: ["Resolved \u0001300 anomalies\u0002 \u2014 80% rate"],
            },
          ],
        },
        template,
      );
      expect(latex).toContain("Built \\textbf{RAG \\& agents} at 100\\%");
      expect(latex).toContain(
        "Resolved \\textbf{300 anomalies} --- 80\\% rate",
      );
      expect(latex).toContain("09/2024 -- 02/2026");
      expect(latex.includes("\u0001") || latex.includes("\u0002")).toBe(false);
    });

    it("strips bold markers from places that do not support formatting", () => {
      const latex = buildLatexDocument(
        { ...baseDocument, name: "Jane \u0001Doe\u0002" },
        template,
      );
      expect(latex).toContain("|Jane Doe");
      expect(latex.includes("\u0001") || latex.includes("\u0002")).toBe(false);
    });

    it("puts text-only custom fields on a tagline under the headline", () => {
      const latex = buildLatexDocument(
        {
          ...baseDocument,
          contactItems: [
            { text: "jane@example.com", url: "mailto:jane@example.com" },
            {
              text: "Available from September",
              icon: "calendar",
              kind: "custom",
            },
          ],
        },
        template,
      );
      const headlineIndex = latex.indexOf("Senior Software Engineer");
      const taglineIndex = latex.indexOf("\\faCalendar\\ Available");
      const contactIndex = latex.indexOf("\\faEnvelope");
      expect(taglineIndex).toBeGreaterThan(headlineIndex);
      expect(contactIndex).toBeGreaterThan(taglineIndex);
    });

    it("localizes the certifications and other sections", () => {
      const titles = getLatexResumeSectionTitles("french");
      const latex = buildLatexDocument(
        {
          ...baseDocument,
          sectionTitles: titles,
          languages: ["Français (C1)"],
          interests: ["Échecs"],
          extraSections: [
            {
              title: titles.certifications,
              kind: "certifications",
              entries: [{ title: "Scrum", bullets: [] }],
            },
            {
              title: titles.volunteer,
              kind: "volunteer",
              entries: [{ title: "PMI", date: "2025", bullets: [] }],
            },
          ],
        },
        template,
      );
      expect(latex).toContain("\\section{Certifications}");
      expect(latex).toContain("\\section{Autres}");
      expect(latex).toContain("\\textbf{Bénévolat}");
      expect(latex).toContain("\\textbf{Langues}");
      expect(latex).toContain("\\textbf{Centres d'intérêt}");
      expect(latex).not.toContain("\\section{Other}");
    });

    it("injects the requested one-page fit level", () => {
      expect(buildLatexDocument(baseDocument, template)).toMatch(/^\|/);
      expect(
        buildLatexDocument(baseDocument, template, { fitLevel: 2 }),
      ).toContain(LATEX_FIT_LEVELS[2]);
      expect(LATEX_FIT_LEVELS[0]).toBe("");
      expect(LATEX_FIT_LEVELS.length).toBeGreaterThan(1);
    });
  });

  describe("parseLatexPageCount", () => {
    it("reads the page count from a TeX log", () => {
      expect(
        parseLatexPageCount(
          "...\nOutput written on resume-fit0.xdv (2 pages, 30120 bytes).\n",
        ),
      ).toBe(2);
      expect(
        parseLatexPageCount("Output written on resume.xdv (1 page, 10 bytes)."),
      ).toBe(1);
    });

    it("assumes a single page when the log is missing or unexpected", () => {
      expect(parseLatexPageCount("")).toBe(1);
      expect(parseLatexPageCount("garbage")).toBe(1);
    });
  });

  describe("selectFitLevel", () => {
    const run = async (pagesByLevel: Record<number, number>) => {
      const attempts: number[] = [];
      const chosen = await selectFitLevel(async (fitLevel) => {
        attempts.push(fitLevel);
        return { fitLevel, pages: pagesByLevel[fitLevel] ?? 2 };
      }, 4);
      return { chosen: chosen.fitLevel, attempts };
    };

    it("keeps a CV that already fits on one page untouched", async () => {
      expect(await run({ 0: 1 })).toEqual({ chosen: 0, attempts: [0] });
    });

    it("picks the gentlest level that fits a slight overflow", async () => {
      expect(await run({ 0: 2, 3: 1, 1: 2, 2: 1 })).toEqual({
        chosen: 2,
        attempts: [0, 3, 1, 2],
      });
      expect(await run({ 0: 2, 3: 1, 1: 1 })).toEqual({
        chosen: 1,
        attempts: [0, 3, 1],
      });
    });

    it("gives up after one probe when even the tightest level overflows", async () => {
      expect(await run({ 0: 2, 3: 2 })).toEqual({
        chosen: 0,
        attempts: [0, 3],
      });
    });

    it("never squeezes CVs of three pages or more", async () => {
      expect(await run({ 0: 3 })).toEqual({ chosen: 0, attempts: [0] });
    });
  });
});
