import { QueryClient } from "@tanstack/react-query";

/**
 * Retry a failed query once, except when the server already gave a definite
 * answer (4xx: not found, forbidden, invalid…). Retrying those only doubles
 * the error toasts.
 */
export function shouldRetryQuery(failureCount: number, error: unknown) {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return false;
  }
  return failureCount < 1;
}

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: shouldRetryQuery,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });

export const queryClient = createQueryClient();
