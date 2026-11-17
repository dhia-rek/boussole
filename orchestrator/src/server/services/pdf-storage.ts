import { join } from "node:path";
import { getDataDir } from "@server/config/dataDir";
import { getActiveTenantId } from "@server/tenancy/context";

export function getTenantPdfDir(tenantId = getActiveTenantId()): string {
  return join(getDataDir(), "pdfs", tenantId);
}

export function getLegacyPdfDir(): string {
  return join(getDataDir(), "pdfs");
}

export function getTenantJobPdfPath(jobId: string): string {
  return join(getTenantPdfDir(), `resume_${jobId}.pdf`);
}

export function getLegacyJobPdfPath(jobId: string): string {
  return join(getLegacyPdfDir(), `resume_${jobId}.pdf`);
}

/**
 * Preview PDF of a Design Resume variant. The primary CV keeps the historical
 * file name; language variants get their own file so previews of the French
 * and English CVs never overwrite each other.
 */
export function getTenantDesignResumePdfPath(language?: string | null): string {
  const suffix = language && /^[a-z]{2}$/.test(language) ? `_${language}` : "";
  return join(getTenantPdfDir(), `design_resume_current${suffix}.pdf`);
}
