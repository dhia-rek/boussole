import type { JobStatus } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/client/lib/queryKeys";
import * as api from "../api";

export type JobStatusCounts = Record<JobStatus, number>;

/**
 * Job counts per status for navigation badges. Asks for the (small)
 * in-progress list because every jobs response carries counts for all
 * statuses.
 */
export function useJobStatusCounts(): {
  counts: JobStatusCounts | null;
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: queryKeys.jobs.statusCounts(),
    queryFn: () => api.getJobs({ statuses: ["in_progress"], view: "list" }),
    select: (data) => data.byStatus,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  return { counts: query.data ?? null, isLoading: query.isLoading };
}
