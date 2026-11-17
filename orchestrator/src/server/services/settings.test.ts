import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/repositories/settings", () => ({
  getAllSettings: vi.fn(),
}));

vi.mock("./design-resume", () => ({
  getCurrentDesignResumeOrNullOnLegacy: vi.fn(),
  designResumeToProfile: vi.fn(),
}));

vi.mock("./envSettings", () => ({
  getEnvSettingsData: vi.fn(),
  getOriginalEnvValue: vi.fn(),
}));

vi.mock("./profile", () => ({
  getProfile: vi.fn(),
}));

vi.mock("./resumeProjects", () => ({
  extractProjectsFromProfile: vi.fn(),
  resolveResumeProjectsSettings: vi.fn(),
}));

vi.mock("./resume-data", () => ({
  extractProjectsFromResume: vi.fn(),
}));

import { getAllSettings } from "@server/repositories/settings";
import {
  designResumeToProfile,
  getCurrentDesignResumeOrNullOnLegacy,
} from "./design-resume";
import { getEnvSettingsData } from "./envSettings";
import { getProfile } from "./profile";
import { extractProjectsFromResume } from "./resume-data";
import {
  extractProjectsFromProfile,
  resolveResumeProjectsSettings,
} from "./resumeProjects";
import { getEffectiveSettings } from "./settings";

describe("getEffectiveSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllSettings).mockResolvedValue({});
    vi.mocked(getCurrentDesignResumeOrNullOnLegacy).mockResolvedValue({
      id: "primary",
      resumeJson: {},
    } as never);
    vi.mocked(designResumeToProfile).mockResolvedValue({
      basics: { name: "Local User" },
      sections: { projects: { items: [] } },
    } as never);
    vi.mocked(getEnvSettingsData).mockResolvedValue({} as never);
    vi.mocked(getProfile).mockResolvedValue({} as never);
    vi.mocked(extractProjectsFromProfile).mockReturnValue({
      catalog: [{ id: "local-project", label: "Local project" }],
      selectionItems: [],
    } as never);
    vi.mocked(extractProjectsFromResume).mockImplementation(() => {
      throw new Error("should use the profile project extractor");
    });
    vi.mocked(resolveResumeProjectsSettings).mockImplementation(
      ({ catalog }) =>
        ({
          profileProjects: catalog,
          resumeProjects: {
            lockedProjectIds: [],
            aiSelectableProjectIds: [],
            maxProjects: 3,
          },
          defaultResumeProjects: {
            lockedProjectIds: [],
            aiSelectableProjectIds: [],
            maxProjects: 3,
          },
          overrideResumeProjects: null,
        }) as never,
    );
  });

  it("uses extractProjectsFromProfile for a local Design Resume projection", async () => {
    const settings = await getEffectiveSettings();

    expect(extractProjectsFromProfile).toHaveBeenCalledTimes(1);
    expect(extractProjectsFromResume).not.toHaveBeenCalled();
    expect(settings.profileProjects).toEqual([
      { id: "local-project", label: "Local project" },
    ]);
  });

  it("falls back when no compatible local Design Resume is available", async () => {
    vi.mocked(getCurrentDesignResumeOrNullOnLegacy).mockResolvedValue(null);

    await expect(getEffectiveSettings()).resolves.toBeTruthy();
    expect(designResumeToProfile).not.toHaveBeenCalled();
  });
});
