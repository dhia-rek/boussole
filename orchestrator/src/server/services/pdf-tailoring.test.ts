import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDesignResumeForJobLanguage,
  requireCurrentDesignResume,
} from "./design-resume";
import { generateDesignResumePdf, generatePdf } from "./pdf";
import * as projectSelection from "./projectSelection";

// Define mock data in hoisted block
const { currentLanguageSettings, mocks, mockProfile, mockResumeRenderer } =
  vi.hoisted(() => {
    const profile = {
      $schema: "https://rxresu.me/schema.json",
      version: "5.0.0",
      picture: {
        hidden: true,
        url: "",
        size: 96,
        rotation: 0,
        aspectRatio: 1,
        borderRadius: 0,
        borderColor: "#000000",
        borderWidth: 0,
        shadowColor: "#000000",
        shadowWidth: 0,
      },
      basics: {
        name: "",
        headline: "Original Headline",
        email: "",
        phone: "",
        location: "",
        website: {
          url: "",
          label: "",
        },
        customFields: [],
      },
      summary: {
        title: "Summary",
        columns: 1,
        hidden: false,
        content: "Original Summary",
      },
      sections: {
        profiles: { title: "Profiles", columns: 1, hidden: false, items: [] },
        experience: {
          title: "Experience",
          columns: 1,
          hidden: false,
          items: [],
        },
        education: {
          title: "Education",
          columns: 1,
          hidden: false,
          items: [],
        },
        projects: {
          title: "Projects",
          columns: 1,
          hidden: false,
          items: [
            {
              id: "p1",
              hidden: false,
              name: "Project 1",
              period: "",
              website: { url: "", label: "" },
              description: "",
              options: { showLinkInTitle: false },
            },
            {
              id: "p2",
              hidden: false,
              name: "Project 2",
              period: "",
              website: { url: "", label: "" },
              description: "",
              options: { showLinkInTitle: false },
            },
          ],
        },
        skills: {
          title: "Skills",
          columns: 1,
          hidden: false,
          items: [
            {
              id: "skill-1",
              hidden: false,
              icon: "",
              name: "Original Skill",
              proficiency: "",
              level: 0,
              keywords: [],
            },
          ],
        },
        languages: {
          title: "Languages",
          columns: 1,
          hidden: false,
          items: [],
        },
        interests: {
          title: "Interests",
          columns: 1,
          hidden: false,
          items: [],
        },
        awards: { title: "Awards", columns: 1, hidden: false, items: [] },
        certifications: {
          title: "Certifications",
          columns: 1,
          hidden: false,
          items: [],
        },
        publications: {
          title: "Publications",
          columns: 1,
          hidden: false,
          items: [],
        },
        volunteer: {
          title: "Volunteer",
          columns: 1,
          hidden: false,
          items: [],
        },
        references: {
          title: "References",
          columns: 1,
          hidden: false,
          items: [],
        },
      },
      customSections: [],
      metadata: {
        template: "rhyhorn",
        layout: {
          sidebarWidth: 220,
          pages: [
            {
              fullWidth: false,
              main: ["summary", "experience", "education", "projects"],
              sidebar: ["profiles", "skills", "languages"],
            },
          ],
        },
        css: {
          enabled: false,
          value: "",
        },
        page: {
          gapX: 18,
          gapY: 18,
          marginX: 18,
          marginY: 18,
          format: "a4",
          locale: "en",
          hideIcons: false,
          options: {
            breakLine: true,
            pageNumbers: true,
          },
        },
        design: {
          level: {
            icon: "circle",
            type: "hidden",
          },
          colors: {
            background: "#ffffff",
            text: "#000000",
            primary: "#2563eb",
          },
        },
        typography: {
          body: {
            fontFamily: "Inter",
            fontWeights: ["regular"],
            fontSize: 14,
            lineHeight: 1.5,
          },
          heading: {
            fontFamily: "Inter",
            fontWeights: ["600"],
            fontSize: 14,
            lineHeight: 1.25,
          },
        },
        notes: "",
      },
    };

    let lastResumeArgs: any = null;
    const renderer = {
      renderResumePdf: vi.fn().mockImplementation(async (args: any) => {
        lastResumeArgs = JSON.parse(JSON.stringify(args));
      }),
      getLastResumeJson: () => lastResumeArgs?.resumeJson ?? null,
      getLastResumeArgs: () => lastResumeArgs,
      clearLastResumeJson: () => {
        lastResumeArgs = null;
      },
    };

    return {
      currentLanguageSettings: {
        mode: "manual" as "manual" | "match-resume",
        manual: "english" as "english" | "german" | "french" | "spanish",
      },
      mockProfile: profile,
      mocks: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn().mockResolvedValue(undefined),
        access: vi.fn().mockResolvedValue(undefined),
        unlink: vi.fn().mockResolvedValue(undefined),
        getDesignResumeAssetById: vi.fn(),
      },
      mockResumeRenderer: renderer,
    };
  });

// Configure base mock implementations
mocks.readFile.mockResolvedValue(JSON.stringify(mockProfile));
mocks.writeFile.mockResolvedValue(undefined);

vi.mock("fs/promises", async () => {
  return {
    default: mocks,
    ...mocks,
  };
});

vi.mock("node:fs/promises", async () => {
  return {
    default: mocks,
    ...mocks,
  };
});

vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
  createWriteStream: vi.fn().mockReturnValue({
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  }),
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    createWriteStream: vi.fn().mockReturnValue({
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    }),
  },
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
  createWriteStream: vi.fn().mockReturnValue({
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  }),
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    createWriteStream: vi.fn().mockReturnValue({
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    }),
  },
}));

vi.mock("../repositories/settings", () => ({
  getSetting: vi.fn().mockImplementation((key: string) => {
    if (key === "chatStyleLanguageMode") {
      return Promise.resolve(currentLanguageSettings.mode);
    }
    if (key === "chatStyleManualLanguage") {
      return Promise.resolve(currentLanguageSettings.manual);
    }
    return Promise.resolve(null);
  }),
  getAllSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock("./profile", () => ({
  getProfile: vi.fn().mockResolvedValue(mockProfile),
}));

vi.mock("./projectSelection", () => ({
  pickProjectIdsForJob: vi.fn().mockResolvedValue([]),
}));

vi.mock("./resumeProjects", () => ({
  extractProjectsFromProfile: vi.fn().mockReturnValue({
    catalog: [],
    selectionItems: [
      { id: "p1", name: "Project 1" },
      { id: "p2", name: "Project 2" },
    ],
  }),
  resolveResumeProjectsSettings: vi.fn().mockReturnValue({
    resumeProjects: {
      lockedProjectIds: [],
      aiSelectableProjectIds: ["p1", "p2"],
      maxProjects: 3,
    },
  }),
}));

vi.mock("./resume-renderer", () => ({
  renderResumePdf: mockResumeRenderer.renderResumePdf,
}));

const mockTracerLinks = vi.hoisted(() => ({
  resolveTracerPublicBaseUrl: vi.fn().mockReturnValue("https://boussole.example"),
  getBoussolePublicAvailability: vi.fn().mockResolvedValue({
    status: "ready",
    isPubliclyAvailable: true,
    publicBaseUrl: "https://boussole.example",
    healthUrl: "https://boussole.example/health",
    checkedAt: 1,
    lastSuccessAt: 1,
    reason: null,
  }),
  getTracerReadiness: vi.fn().mockResolvedValue({
    status: "ready",
    isPubliclyAvailable: true,
    canEnable: true,
    publicBaseUrl: "https://boussole.example",
    healthUrl: "https://boussole.example/health",
    checkedAt: 1,
    lastSuccessAt: 1,
    reason: null,
  }),
  rewriteResumeLinksWithTracer: vi
    .fn()
    .mockResolvedValue({ rewrittenLinks: 2 }),
}));

vi.mock("./tracer-links", () => ({
  getBoussolePublicAvailability: mockTracerLinks.getBoussolePublicAvailability,
  getTracerReadiness: mockTracerLinks.getTracerReadiness,
  resolveTracerPublicBaseUrl: mockTracerLinks.resolveTracerPublicBaseUrl,
  rewriteResumeLinksWithTracer: mockTracerLinks.rewriteResumeLinksWithTracer,
}));

vi.mock("./design-resume", () => ({
  getDesignResumeForJobLanguage: vi.fn().mockImplementation(async () => ({
    id: "design-resume-1",
    title: "My CV",
    resumeJson: mockProfile,
    aiGuidance: null,
    language: null,
  })),
  requireCurrentDesignResume: vi.fn(),
}));

vi.mock("@server/repositories/design-resume", () => ({
  getDesignResumeAssetById: mocks.getDesignResumeAssetById,
}));

vi.mock("./resume-data/schema/v5", () => ({
  parseV5ResumeData: (data: unknown) => data,
}));

vi.mock("./resume-data", async () => {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const projectSelectionModule = await import("./projectSelection");
  return {
    prepareTailoredResumeForPdf: vi
      .fn()
      .mockImplementation(async (args: any) => {
        const data = clone(args.resumeData);
        if (args.tailedContent?.summary || args.tailoredContent?.summary) {
          const summary = args.tailoredContent?.summary;
          if (data.summary) data.summary.content = summary;
        }
        if (args.tailoredContent?.headline && data.basics) {
          data.basics.headline = args.tailoredContent.headline;
        }

        let selected = (args.selectedProjectIds as string | null | undefined)
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (!selected) {
          selected = await projectSelectionModule.pickProjectIdsForJob({
            jobDescription: args.jobDescription,
            eligibleProjects: [
              { id: "p1", name: "Project 1" },
              { id: "p2", name: "Project 2" },
            ],
            desiredCount: 3,
          } as any);
        }
        const selectedSet = new Set(selected);
        for (const item of data.sections?.projects?.items ?? []) {
          item.hidden = !selectedSet.has(item.id);
        }
        if (data.sections?.projects) data.sections.projects.hidden = false;

        if (args.tracerLinks?.enabled) {
          mockTracerLinks.resolveTracerPublicBaseUrl({
            requestOrigin: args.tracerLinks.requestOrigin,
          });
          await mockTracerLinks.rewriteResumeLinksWithTracer({
            jobId: args.jobId,
            resumeData: data,
            publicBaseUrl: "https://boussole.example",
            companyName: args.tracerLinks.companyName ?? null,
          });
        }

        return {
          mode: args.mode,
          data,
          projectCatalog: [],
          selectedProjectIds: [...selectedSet],
        };
      }),
  };
});

describe("PDF Service Tailoring Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentLanguageSettings.mode = "manual";
    currentLanguageSettings.manual = "english";
    mockProfile.summary.content = "Original Summary";
    mockProfile.sections.projects.items[0].description = "";
    mockProfile.picture.hidden = true;
    mockProfile.picture.url = "";
    mocks.readFile.mockResolvedValue(JSON.stringify(mockProfile));
    mockResumeRenderer.clearLastResumeJson();
    mockTracerLinks.resolveTracerPublicBaseUrl.mockReturnValue(
      "https://boussole.example",
    );
    mockTracerLinks.getBoussolePublicAvailability.mockResolvedValue({
      status: "ready",
      isPubliclyAvailable: true,
      publicBaseUrl: "https://boussole.example",
      healthUrl: "https://boussole.example/health",
      checkedAt: 1,
      lastSuccessAt: 1,
      reason: null,
    });
    mockTracerLinks.getTracerReadiness.mockResolvedValue({
      status: "ready",
      isPubliclyAvailable: true,
      canEnable: true,
      publicBaseUrl: "https://boussole.example",
      healthUrl: "https://boussole.example/health",
      checkedAt: 1,
      lastSuccessAt: 1,
      reason: null,
    });
    mockTracerLinks.rewriteResumeLinksWithTracer.mockResolvedValue({
      rewrittenLinks: 2,
    });
  });

  it("should use provided selectedProjectIds and BYPASS AI selection", async () => {
    const tailoredContent = {
      summary: "New Sum",
      headline: "New Head",
      skills: [],
    };

    await generatePdf("job-1", tailoredContent, "Job Desc", "base.json", "p2");

    // 1. pickProjectIdsForJob should NOT be called
    expect(projectSelection.pickProjectIdsForJob).not.toHaveBeenCalled();

    // 2. Verify prepared resume content
    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalled();
    const savedResumeJson = mockResumeRenderer.getLastResumeJson();

    const projects = savedResumeJson.sections.projects.items;
    const p1 = projects.find((p: any) => p.id === "p1");
    const p2 = projects.find((p: any) => p.id === "p2");

    expect(p2.hidden).toBe(false);
    expect(p1.hidden).toBe(true);

    // 3. Verify Summary Update
    const summary = savedResumeJson.summary.content;
    expect(summary).toBe("New Sum");
  });

  it("should handle comma-separated project IDs correctly", async () => {
    await generatePdf("job-2", {}, "desc", "base.json", "p1, p2 ");

    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalled();
    const savedResumeJson = mockResumeRenderer.getLastResumeJson();
    const projects = savedResumeJson.sections.projects.items;

    expect(projects.find((p: any) => p.id === "p1").hidden).toBe(false);
    expect(projects.find((p: any) => p.id === "p2").hidden).toBe(false);
  });

  it("keeps projects section visible when selected project list is explicitly empty", async () => {
    await generatePdf("job-empty-projects", {}, "desc", "base.json", "");

    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalled();
    const savedResumeJson = mockResumeRenderer.getLastResumeJson();
    const projects = savedResumeJson.sections.projects.items;

    expect(projects.find((p: any) => p.id === "p1").hidden).toBe(true);
    expect(projects.find((p: any) => p.id === "p2").hidden).toBe(true);
    expect(savedResumeJson.sections.projects.hidden).toBe(false);
  });

  it("should fall back to AI selection if selectedProjectIds is null/undefined", async () => {
    // Setup AI selection mock for this test
    vi.mocked(projectSelection.pickProjectIdsForJob).mockResolvedValue(["p1"]);

    await generatePdf("job-3", {}, "desc", "base.json", undefined);

    expect(projectSelection.pickProjectIdsForJob).toHaveBeenCalled();

    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalled();
    const savedResumeJson = mockResumeRenderer.getLastResumeJson();

    const p1 = savedResumeJson.sections.projects.items.find(
      (p: any) => p.id === "p1",
    );
    const p2 = savedResumeJson.sections.projects.items.find(
      (p: any) => p.id === "p2",
    );

    expect(p1.hidden).toBe(false);
    expect(p2.hidden).toBe(true);

    const visibleCount = savedResumeJson.sections.projects.items.filter(
      (p: any) => !p.hidden,
    ).length;
    expect(visibleCount).toBe(1);
  });

  it("does not rewrite links when tracer links are disabled", async () => {
    await generatePdf("job-no-tracer", {}, "desc", undefined, undefined, {
      tracerLinksEnabled: false,
    });

    expect(mockTracerLinks.resolveTracerPublicBaseUrl).not.toHaveBeenCalled();
    expect(mockTracerLinks.rewriteResumeLinksWithTracer).not.toHaveBeenCalled();
  });

  it("rewrites links when tracer links are enabled", async () => {
    await generatePdf("job-with-tracer", {}, "desc", undefined, undefined, {
      tracerLinksEnabled: true,
      requestOrigin: "https://boussole.example",
    });

    expect(mockTracerLinks.resolveTracerPublicBaseUrl).toHaveBeenCalledWith({
      requestOrigin: "https://boussole.example",
    });
    expect(mockTracerLinks.rewriteResumeLinksWithTracer).toHaveBeenCalledTimes(
      1,
    );
  });

  it("passes the manual output language to the local LaTeX renderer", async () => {
    currentLanguageSettings.mode = "manual";
    currentLanguageSettings.manual = "spanish";

    await generatePdf("job-spanish-latex", {}, "desc");

    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-spanish-latex",
        language: "spanish",
      }),
    );
  });

  it("detects the resume language for local LaTeX rendering", async () => {
    currentLanguageSettings.mode = "match-resume";
    mockProfile.summary.content =
      "Je construis des systèmes fiables avec une expérience forte dans le développement.";
    mockProfile.sections.projects.items[0].description =
      "Responsable des APIs et du développement pour les équipes produit.";

    await generatePdf("job-french-latex", {}, "desc");

    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-french-latex",
        language: "french",
      }),
    );
  });
  it("renders from the CV editor's document for the job's language", async () => {
    await generatePdf("job-cv-editor", {}, "Poste de data engineer à Paris");

    expect(getDesignResumeForJobLanguage).toHaveBeenCalledWith(
      "Poste de data engineer à Paris",
    );
    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-cv-editor",
        outputPath: expect.stringContaining("job-cv-editor"),
        photoPath: null,
      }),
    );
  });

  it("uses the CV variant's own language for the LaTeX section titles", async () => {
    currentLanguageSettings.manual = "english";
    vi.mocked(getDesignResumeForJobLanguage).mockResolvedValueOnce({
      id: "design-resume-fr",
      title: "Mon CV",
      resumeJson: mockProfile,
      aiGuidance: null,
      language: "fr",
    } as never);

    await generatePdf("job-french-variant", {}, "desc");

    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-french-variant",
        language: "french",
      }),
    );
  });

  it("passes the stored CV photo to the renderer", async () => {
    mockProfile.picture.hidden = false;
    mockProfile.picture.url = "/api/design-resume/assets/asset%2D1/content";
    mocks.getDesignResumeAssetById.mockResolvedValue({
      id: "asset-1",
      storagePath: "/data/design-resume/assets/photo.jpg",
    });

    await generatePdf("job-with-photo", {}, "desc");

    expect(mocks.getDesignResumeAssetById).toHaveBeenCalledWith("asset-1");
    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-with-photo",
        photoPath: "/data/design-resume/assets/photo.jpg",
      }),
    );
  });

  it("leaves the photo out when the CV picture is hidden", async () => {
    mockProfile.picture.hidden = true;
    mockProfile.picture.url = "/api/design-resume/assets/asset-1/content";

    await generatePdf("job-hidden-photo", {}, "desc");

    expect(mocks.getDesignResumeAssetById).not.toHaveBeenCalled();
    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalledWith(
      expect.objectContaining({ photoPath: null }),
    );
  });

  it("reports a conflict when the CV editor has no CV", async () => {
    vi.mocked(getDesignResumeForJobLanguage).mockResolvedValueOnce(null);

    const result = await generatePdf("job-no-cv", {}, "desc");

    expect(result).toEqual({
      success: false,
      error: "No CV yet. Create or import your CV in the CV editor first.",
      errorCode: "CONFLICT",
    });
    expect(mockResumeRenderer.renderResumePdf).not.toHaveBeenCalled();
  });
  it("renders the CV editor's own PDF in the Boussole layout with its photo", async () => {
    vi.mocked(requireCurrentDesignResume).mockResolvedValueOnce({
      id: "design-resume-en",
      title: "Jane Doe",
      language: "en",
      resumeJson: {
        ...mockProfile,
        picture: {
          ...mockProfile.picture,
          hidden: false,
          url: "/api/design-resume/assets/photo-1/content",
        },
      },
    } as never);
    mocks.getDesignResumeAssetById.mockResolvedValue({
      id: "photo-1",
      storagePath: "/data/design-resume/assets/photo-1.png",
    });

    const result = await generateDesignResumePdf({
      requestOrigin: "http://localhost:3005",
      language: "en",
    });

    expect(requireCurrentDesignResume).toHaveBeenCalledWith({
      language: "en",
    });
    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "design-resume",
        language: "english",
        photoPath: "/data/design-resume/assets/photo-1.png",
      }),
    );
    expect(result).toEqual({
      fileName: "Jane_Doe_en.pdf",
      pdfUrl: expect.stringMatching(
        /^\/api\/design-resume\/pdf\?v=.+&language=en$/,
      ),
      generatedAt: expect.any(String),
    });
  });
});
