import type {
  SpontaneousOutreach,
  SpontaneousSuggestion,
} from "@shared/types.js";
import { fetchApi } from "./core";

export function getSpontaneousSuggestions(): Promise<SpontaneousSuggestion[]> {
  return fetchApi<SpontaneousSuggestion[]>("/spontaneous/suggestions");
}

export function getSpontaneousHistory(): Promise<SpontaneousOutreach[]> {
  return fetchApi<SpontaneousOutreach[]>("/spontaneous/outreach");
}

export function getSpontaneousOutreach(
  id: string,
): Promise<SpontaneousOutreach> {
  return fetchApi<SpontaneousOutreach>(
    `/spontaneous/outreach/${encodeURIComponent(id)}`,
  );
}

export function startSpontaneousOutreach(input: {
  company: string;
  website?: string | null;
}): Promise<SpontaneousOutreach> {
  return fetchApi<SpontaneousOutreach>("/spontaneous/outreach", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function writeSpontaneousEmail(
  id: string,
  input: {
    recipient: string | null;
    recipientName: string | null;
    targetRole: string | null;
    language: "fr" | "en";
  },
): Promise<SpontaneousOutreach> {
  return fetchApi<SpontaneousOutreach>(
    `/spontaneous/outreach/${encodeURIComponent(id)}/email`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function logSpontaneousSent(
  id: string,
  input: { recipient: string | null; subject: string; body: string },
): Promise<SpontaneousOutreach> {
  return fetchApi<SpontaneousOutreach>(
    `/spontaneous/outreach/${encodeURIComponent(id)}/sent`,
    { method: "POST", body: JSON.stringify(input) },
  );
}
