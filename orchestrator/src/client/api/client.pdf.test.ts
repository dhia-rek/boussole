import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./client";

function json(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  } as Response;
}

const inProgress = json(409, {
  ok: false,
  error: {
    code: "CONFLICT",
    message:
      "PDF regeneration is already in progress for this job. Please wait for it to finish.",
  },
  meta: { requestId: "r" },
});
const job = (fields: Record<string, unknown>) =>
  json(200, {
    ok: true,
    data: { id: "job-1", ...fields },
    meta: { requestId: "r" },
  });

describe("generateJobPdf", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    api.__resetApiClientAuthForTests();
  });

  it("waits for a build that is already running instead of failing", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(inProgress)
      .mockResolvedValueOnce(
        job({ pdfRegenerating: true, pdfFreshness: "regenerating" }),
      )
      .mockResolvedValueOnce(
        job({ pdfRegenerating: false, pdfFreshness: "current" }),
      );

    await expect(
      api.generateJobPdf("job-1", { intervalMs: 1, timeoutMs: 1000 }),
    ).resolves.toMatchObject({ pdfFreshness: "current" });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("builds again when the running build rendered outdated content", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(inProgress)
      .mockResolvedValueOnce(
        job({ pdfRegenerating: false, pdfFreshness: "stale" }),
      )
      .mockResolvedValueOnce(
        job({ pdfRegenerating: false, pdfFreshness: "current" }),
      );

    await expect(
      api.generateJobPdf("job-1", { intervalMs: 1, timeoutMs: 1000 }),
    ).resolves.toMatchObject({ pdfFreshness: "current" });
    const posts = fetchSpy.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(posts).toHaveLength(2);
  });

  it("still reports other errors", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      json(500, {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "LaTeX failed" },
        meta: { requestId: "r" },
      }),
    );
    await expect(
      api.generateJobPdf("job-1", { intervalMs: 1, timeoutMs: 1000 }),
    ).rejects.toThrow(/LaTeX failed/);
  });
});
