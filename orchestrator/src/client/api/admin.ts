import type {
  BackupInfo,
  DemoInfoResponse,
  Job,
  ManualJobDraft,
  ManualJobFetchResponse,
  ManualJobInferenceResponse,
} from "@shared/types";
import { fetchApi } from "./core";

export async function getDemoInfo(): Promise<DemoInfoResponse> {
  return fetchApi<DemoInfoResponse>("/demo/info");
}

export async function fetchJobFromUrl(input: {
  url: string;
}): Promise<ManualJobFetchResponse> {
  return fetchApi<ManualJobFetchResponse>("/manual-jobs/fetch", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function inferManualJob(input: {
  jobDescription: string;
}): Promise<ManualJobInferenceResponse> {
  return fetchApi<ManualJobInferenceResponse>("/manual-jobs/infer", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function importManualJob(input: {
  job: ManualJobDraft;
}): Promise<Job & { alreadyInList?: boolean }> {
  return fetchApi<Job & { alreadyInList?: boolean }>("/manual-jobs/import", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function clearDatabase(): Promise<{
  message: string;
  jobsDeleted: number;
  runsDeleted: number;
}> {
  return fetchApi<{
    message: string;
    jobsDeleted: number;
    runsDeleted: number;
  }>("/database", {
    method: "DELETE",
  });
}

export async function deleteJobsByStatus(status: string): Promise<{
  message: string;
  count: number;
}> {
  return fetchApi<{
    message: string;
    count: number;
  }>(`/jobs/status/${status}`, {
    method: "DELETE",
  });
}

export async function deleteJobsBelowScore(threshold: number): Promise<{
  message: string;
  count: number;
  threshold: number;
}> {
  return fetchApi<{
    message: string;
    count: number;
    threshold: number;
  }>(`/jobs/score/${threshold}`, {
    method: "DELETE",
  });
}

export interface BackupListResponse {
  backups: BackupInfo[];
  nextScheduled: string | null;
}

export async function getBackups(): Promise<BackupListResponse> {
  return fetchApi<BackupListResponse>("/backups");
}

export async function createManualBackup(): Promise<BackupInfo> {
  return fetchApi<BackupInfo>("/backups", {
    method: "POST",
  });
}

export async function deleteBackup(filename: string): Promise<void> {
  await fetchApi<void>(`/backups/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
}
