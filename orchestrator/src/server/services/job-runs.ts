/**
 * Background work that runs once at a time per workspace and job (company
 * research, CV check). The page polls for the result; a stored "running"
 * record without a live run here means the server restarted mid-run.
 */
import { conflict } from "@infra/errors";
import { runWithRequestContext } from "@infra/request-context";
import { getActiveTenantId } from "@server/tenancy/context";

export type JobRunTracker = {
  isRunning(jobId: string): boolean;
  /**
   * Claims the job's slot (CONFLICT if taken), runs `prepare` (e.g. saving a
   * "running" record), then `work` in the background with the workspace and
   * job in the logging context. The slot is freed when `work` settles, or
   * right away if `prepare` throws.
   */
  start<T>(
    jobId: string,
    prepare: () => Promise<T>,
    work: (prepared: T) => Promise<void>,
  ): Promise<T>;
  /** Waits for the job's run, if any (tests). */
  wait(jobId: string): Promise<void>;
};

export function createJobRunTracker(conflictMessage: string): JobRunTracker {
  const runs = new Map<string, Promise<void>>();
  const keyOf = (jobId: string) => `${getActiveTenantId()}:${jobId}`;

  return {
    isRunning: (jobId) => runs.has(keyOf(jobId)),
    async start(jobId, prepare, work) {
      const tenantId = getActiveTenantId();
      const key = keyOf(jobId);
      if (runs.has(key)) throw conflict(conflictMessage);
      // Claim the slot before the first await so a double click cannot start two.
      let release: () => void = () => undefined;
      runs.set(
        key,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      let prepared: Awaited<ReturnType<typeof prepare>>;
      try {
        prepared = await prepare();
      } catch (error) {
        runs.delete(key);
        release();
        throw error;
      }
      const run = runWithRequestContext({ tenantId, jobId }, () =>
        work(prepared),
      ).finally(() => {
        runs.delete(key);
        release();
      });
      runs.set(key, run);
      return prepared;
    },
    async wait(jobId) {
      await runs.get(keyOf(jobId));
    },
  };
}
