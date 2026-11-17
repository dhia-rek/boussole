import { logger } from "@infra/logger";
import * as settingsRepo from "@server/repositories/settings";
import { settingsRegistry } from "@shared/settings-registry";
import type { AppSettings, ResumeProfile } from "@shared/types";
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

/**
 * Get the effective app settings, combining environment variables and database overrides.
 */
export async function getEffectiveSettings(): Promise<AppSettings> {
  const getAllSettings =
    "getAllSettings" in settingsRepo ? settingsRepo.getAllSettings : null;
  const overrides =
    (typeof getAllSettings === "function" ? await getAllSettings() : null) ??
    {};

  let profile: Record<string, unknown> = {};
  let localProfile: ResumeProfile | null = null;

  const localDesignResume = await getCurrentDesignResumeOrNullOnLegacy();
  if (localDesignResume?.resumeJson) {
    localProfile = await designResumeToProfile(localDesignResume);
    profile = (localProfile as Record<string, unknown> | null) ?? {};
  }

  if (Object.keys(profile).length === 0) {
    profile = await getProfile().catch((error) => {
      logger.warn("Failed to load base resume profile for settings", { error });
      return {};
    });
  }

  const envSettings = await getEnvSettingsData(overrides);

  const result: Partial<AppSettings> = {
    ...envSettings,
  };

  for (const [key, def] of Object.entries(settingsRegistry)) {
    if (def.kind === "typed") {
      let rawOverride = overrides[key as settingsRepo.SettingKey];
      if (key === "searchCities" && !rawOverride) {
        rawOverride = overrides.jobspyLocation; // legacy fallback
      }

      const override = def.parse(rawOverride);
      const defaultValue = def.default();

      if (key === "resumeProjects") {
        let catalog: AppSettings["profileProjects"] = [];
        if (Object.keys(profile).length > 0) {
          try {
            catalog = localProfile
              ? extractProjectsFromProfile(localProfile).catalog
              : extractProjectsFromResume(profile).catalog;
          } catch (error) {
            logger.warn("Failed to extract projects from resume data", {
              error,
            });
          }
        }
        const resolved = resolveResumeProjectsSettings({
          catalog,
          overrideRaw: rawOverride ?? null,
        });
        result.profileProjects = resolved.profileProjects;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // biome-ignore lint/suspicious/noExplicitAny: dynamic assignment for settings building
        (result as any).resumeProjects = {
          value: resolved.resumeProjects,
          default: resolved.defaultResumeProjects,
          override: resolved.overrideResumeProjects,
        };
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // biome-ignore lint/suspicious/noExplicitAny: dynamic assignment for settings building
      (result as any)[key] = {
        value: override ?? defaultValue,
        default: defaultValue,
        override,
      };
    } else if (def.kind === "string") {
      if (!("envKey" in def) || !def.envKey) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // biome-ignore lint/suspicious/noExplicitAny: dynamic assignment for settings building
        (result as any)[key] =
          overrides[key as settingsRepo.SettingKey] ?? null;
      }
    }
  }

  return result as AppSettings;
}
