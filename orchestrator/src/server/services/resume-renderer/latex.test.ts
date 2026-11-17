import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeResumeJsonToLatexDocument } from "./document";
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
  return await mkdtemp(join(tmpdir(), "forsa-latex-render-test-"));
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

  it("exposes the bundled Boussole template", async () => {
    expect(getLatexTemplatePath()).toMatch(/templates[\\/]resume\.tex$/);
    const template = await readLatexTemplate();
    expect(template).toContain("Boussole CV layout");
    for (const placeholder of [
      "__BABEL__",
      "__FIT__",
      "__HEADER__",
      "__BODY__",
    ]) {
      expect(template).toContain(placeholder);
    }
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

  it("defaults LaTeX section titles and hyphenation to English", () => {
    const latex = buildLatexDocument(
      {
        ...baseDocument,
        language: undefined,
      },
      "__BABEL__\n__HEADER__\n__BODY__",
    );

    expect(latex.startsWith("english\n")).toBe(true);
    expect(latex).toContain("\\section{Profile}");
    expect(latex).toContain("\\section{Experience}");
    expect(latex).toContain("\\section{Technical Skills}");
  });

  it("renders localized LaTeX section titles", () => {
    const document: LatexResumeDocument = {
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
    };

    const spanish = buildLatexDocument(
      { ...document, language: "spanish" },
      "__BABEL__\n__BODY__",
    );
    expect(spanish.startsWith("spanish\n")).toBe(true);
    expect(spanish).toContain("\\section{Perfil}");
    expect(spanish).toContain("\\section{Experiencia}");
    expect(spanish).toContain("\\section{Formación}");
    expect(spanish).toContain("\\section{Proyectos}");
    expect(spanish).toContain("\\section{Competencias técnicas}");

    const french = buildLatexDocument(
      { ...document, language: "french" },
      "__BABEL__\n__BODY__",
    );
    expect(french.startsWith("french\n")).toBe(true);
    expect(french).toContain("\\section{Profil}");
    expect(french).toContain("\\section{Expériences}");
    expect(french).toContain("\\section{Formation}");
    expect(french).toContain("\\section{Projets}");
    expect(french).toContain("\\section{Compétences techniques}");
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
    const template = "__FIT__|__HEADER__\n__BODY__";

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
      expect(latex).toContain("\\textcolor{namecolor}{Jane Doe}");
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
      const taglineIndex = latex.indexOf("Available from September");
      const contactIndex = latex.indexOf("\\cvicon{\\faEnvelope}");
      expect(headlineIndex).toBeGreaterThan(-1);
      expect(taglineIndex).toBeGreaterThan(headlineIndex);
      expect(contactIndex).toBeGreaterThan(taglineIndex);
      expect(latex).toContain(
        "\\cvicon{\\faEnvelope}\\ \\href{mailto:jane@example.com}{jane@example.com}",
      );
    });

    it("puts email, phone and address before profile links in the header", () => {
      const latex = buildLatexDocument(
        {
          ...baseDocument,
          contactItems: [
            { text: "Portfolio", url: "https://jane.dev" },
            { text: "jane@example.com", url: "mailto:jane@example.com" },
            { text: "+33 6 12 34 56 78" },
          ],
          location: "Paris, France",
        },
        template,
      );
      const emailIndex = latex.indexOf("\\faEnvelope");
      const phoneIndex = latex.indexOf("\\faPhone");
      const addressIndex = latex.indexOf(
        "\\cvicon{\\faMapMarker}\\ Paris, France",
      );
      const linkIndex = latex.indexOf(
        "\\cvicon{\\faGlobe}\\ \\href{https://jane.dev}{Portfolio}",
      );
      expect(emailIndex).toBeGreaterThan(-1);
      expect(phoneIndex).toBeGreaterThan(emailIndex);
      expect(addressIndex).toBeGreaterThan(phoneIndex);
      expect(linkIndex).toBeGreaterThan(addressIndex);
    });

    it("lists the CV languages beside the headline", () => {
      const french = buildLatexDocument(
        { ...baseDocument, language: "french", languages: ["Français (C1)"] },
        template,
      );
      expect(french).toContain(
        "\\textbf{Senior Software Engineer --- Langues :} Français (C1)",
      );

      const english = buildLatexDocument(
        { ...baseDocument, languages: ["French", "English"] },
        template,
      );
      expect(english).toContain(
        "\\textbf{Senior Software Engineer --- Bilingual:} French, English",
      );
    });

    it("groups certifications, volunteering and interests in one localized closing section", () => {
      const latex = buildLatexDocument(
        {
          ...baseDocument,
          language: "french",
          interests: ["Échecs"],
          extraSections: [
            {
              title: "Bénévolat",
              kind: "volunteer",
              entries: [{ title: "PMI", date: "2025", bullets: [] }],
            },
            {
              title: "Certifications",
              kind: "certifications",
              entries: [
                { title: "Scrum", bullets: [] },
                { title: "AWS", bullets: [] },
              ],
            },
          ],
        },
        template,
      );
      expect(latex).toContain(
        "\\section{Certifications, Bénévolat \\& Loisirs}",
      );
      expect(latex).toContain(
        "\\textbf{Certifications} : Scrum $|$ AWS\\par\\vspace{2pt}",
      );
      expect(latex).toContain("\\textbf{Bénévolat} : PMI (2025)");
      expect(latex).toContain("\\textbf{Loisirs} : Échecs\\par");
      expect(latex.indexOf("\\textbf{Certifications}")).toBeLessThan(
        latex.indexOf("\\textbf{Bénévolat}"),
      );
      expect(latex).not.toContain("\\section{Other}");
    });

    it("moves a Stack: bullet to the line under its entry", () => {
      const latex = buildLatexDocument(
        {
          ...baseDocument,
          experience: [
            {
              title: "Acme",
              role: "Data Engineer",
              meta: "Paris",
              date: "2024",
              bullets: ["Built pipelines", "\u0001Stack:\u0002 Python, Docker"],
            },
          ],
        },
        template,
      );
      expect(latex).toContain("{Data Engineer}{Paris}");
      expect(latex).toContain("\\resumeItem{Built pipelines}");
      expect(latex).toContain("\\stack{Stack:}{Python, Docker}");
      expect(latex).not.toContain("\\resumeItem{Stack");
    });

    it("adds the round header photo only when a photo is staged", () => {
      const withPhoto = buildLatexDocument(baseDocument, template, {
        photoFileName: "photo.jpg",
      });
      expect(withPhoto).toContain("\\cvphoto{photo.jpg}");
      expect(withPhoto).toContain("\\begin{minipage}[t]{0.76\\textwidth}");

      const withoutPhoto = buildLatexDocument(baseDocument, template);
      expect(withoutPhoto).not.toContain("\\cvphoto");
      expect(withoutPhoto).toContain("\\begin{minipage}[t]{1\\textwidth}");
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

  describe("normalizeResumeJsonToLatexDocument", () => {
    it("carries the CV language and postal location into the document", () => {
      const french = normalizeResumeJsonToLatexDocument(
        {
          basics: {
            name: "Jane Doe",
            headline: "Data Engineer",
            location: "  Paris, France ",
          },
        },
        { language: "french" },
      );
      expect(french).toMatchObject({
        name: "Jane Doe",
        headline: "Data Engineer",
        language: "french",
        location: "Paris, France",
      });

      const english = normalizeResumeJsonToLatexDocument({
        basics: { name: "Jane Doe" },
      });
      expect(english.language).toBe("english");
      expect(english.location).toBeNull();
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
