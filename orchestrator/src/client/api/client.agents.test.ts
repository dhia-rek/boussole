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

describe("startApplicationAgents", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    api.__resetApiClientAuthForTests();
  });

  it("returns the started run from the server's { runId, run } answer", async () => {
    const run = { id: "run-9", kind: "application", status: "queued" };
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      json(202, {
        ok: true,
        data: { runId: "run-9", run },
        meta: { requestId: "r" },
      }),
    );
    const started = await api.startApplicationAgents("job-1");
    expect(started).toEqual(run);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/agents/application/job-1",
    );
  });
});
