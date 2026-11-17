import { logger } from "@infra/logger";
import { getTenantId } from "@infra/request-context";
import { getActiveTenantId } from "@server/tenancy/context";
import type { ResumeProfile } from "@shared/types";
import {
  designResumeProfileForJob,
  designResumeToProfile,
  isLegacyDesignResumeError,
} from "./design-resume";

type TenantProfileCache = {
  localProfile: ResumeProfile | null;
  lastAccessedAt: number;
};

const PROFILE_CACHE_TTL_MS = 30 * 60 * 1000;
const PROFILE_CACHE_MAX_TENANTS = 100;
const profileCacheByTenant = new Map<string, TenantProfileCache>();

function pruneProfileCache(now = Date.now()): void {
  for (const [tenantId, cache] of profileCacheByTenant.entries()) {
    if (now - cache.lastAccessedAt > PROFILE_CACHE_TTL_MS) {
      profileCacheByTenant.delete(tenantId);
    }
  }

  while (profileCacheByTenant.size >= PROFILE_CACHE_MAX_TENANTS) {
    let oldestTenantId: string | null = null;
    let oldestAccessedAt = Number.POSITIVE_INFINITY;
    for (const [tenantId, cache] of profileCacheByTenant.entries()) {
      if (cache.lastAccessedAt < oldestAccessedAt) {
        oldestTenantId = tenantId;
        oldestAccessedAt = cache.lastAccessedAt;
      }
    }
    if (!oldestTenantId) return;
    profileCacheByTenant.delete(oldestTenantId);
  }
}

function getTenantProfileCache(): TenantProfileCache {
  const now = Date.now();
  pruneProfileCache(now);
  const tenantId = getActiveTenantId();
  let cache = profileCacheByTenant.get(tenantId);
  if (!cache) {
    cache = {
      localProfile: null,
      lastAccessedAt: now,
    };
    profileCacheByTenant.set(tenantId, cache);
  }
  cache.lastAccessedAt = now;
  return cache;
}

/**
 * Profile of the CV in the CV editor (Design Resume), cached per workspace
 * until clearProfileCache() is called.
 *
 * @throws Error when no CV has been created or imported yet.
 */
/** The workspace has no CV yet: normal for a new person, not a failure. */
export class NoCvYetError extends Error {
  constructor() {
    super("No CV yet. Create or import your CV in the CV editor first.");
    this.name = "NoCvYetError";
  }
}

export async function getProfile(forceRefresh = false): Promise<ResumeProfile> {
  const cache = getTenantProfileCache();
  if (cache.localProfile && !forceRefresh) {
    return cache.localProfile;
  }

  let localProfile: ResumeProfile | null = null;
  try {
    localProfile = await designResumeToProfile();
  } catch (error) {
    if (!isLegacyDesignResumeError(error)) {
      throw error;
    }
    logger.warn("Ignoring a legacy CV that can no longer be read", { error });
  }

  if (!localProfile) {
    throw new NoCvYetError();
  }
  cache.localProfile = localProfile;
  return localProfile;
}

/**
 * Profile of the CV a job will be rendered with: the Design Resume variant
 * written in the job description's language (e.g. the English CV for an
 * English posting), otherwise the primary profile. Tailoring, project
 * selection and cover letters use this so their output matches the document
 * it is applied to.
 */
export async function getProfileForJob(
  jobDescription: string | null | undefined,
): Promise<ResumeProfile> {
  try {
    const profile = await designResumeProfileForJob(jobDescription);
    if (profile) return profile;
  } catch (error) {
    if (!isLegacyDesignResumeError(error)) {
      throw error;
    }
  }
  return getProfile();
}

/**
 * Clear the profile cache.
 */
export function clearProfileCache(): void {
  const tenantId = getTenantId();
  if (tenantId) {
    profileCacheByTenant.delete(tenantId);
    return;
  }
  profileCacheByTenant.clear();
}

export function __getProfileCacheSizeForTests(): number {
  return profileCacheByTenant.size;
}
