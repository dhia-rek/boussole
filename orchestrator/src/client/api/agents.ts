import type { AgentRun } from "@shared/types.js";
import { fetchApi, withQuery } from "./core";

/** Starts the agent team (analyst, CV tailor, letter writer, critic) for a job. */
export async function startApplicationAgents(jobId: string): Promise<AgentRun> {
  // The server answers { runId, run }.
  const started = await fetchApi<{ runId: string; run: AgentRun }>(
    `/agents/application/${encodeURIComponent(jobId)}`,
    { method: "POST" },
  );
  return started.run;
}

export function getAgentRun(runId: string): Promise<AgentRun> {
  return fetchApi<AgentRun>(`/agents/runs/${encodeURIComponent(runId)}`);
}

export function listAgentRuns(input: {
  jobId?: string;
  limit?: number;
}): Promise<AgentRun[]> {
  return fetchApi<AgentRun[]>(
    withQuery("/agents/runs", { jobId: input.jobId, limit: input.limit }),
  );
}

export function cancelAgentRun(runId: string): Promise<AgentRun> {
  return fetchApi<AgentRun>(
    `/agents/runs/${encodeURIComponent(runId)}/cancel`,
    { method: "POST" },
  );
}
