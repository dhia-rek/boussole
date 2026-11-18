import { createJob } from "@shared/testing/factories";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  reserveNext: vi.fn(),
  acknowledge: vi.fn(),
  reject: vi.fn(),
  getReadyJobsWithGeneratedPdfs: vi.fn(),
}));

vi.mock("@server/infra/job-queue-registry", () => ({
  getJobQueue: vi.fn(() => ({
    enqueue: mocks.enqueue,
    reserveNext: mocks.reserveNext,
    acknowledge: mocks.acknowledge,
    reject: mocks.reject,
  })),
}));

vi.mock("@server/repositories/jobs", () => ({
  getReadyJobsWithGeneratedPdfs: mocks.getReadyJobsWithGeneratedPdfs,
  getJobById: vi.fn(),
}));

vi.mock("@server/repositories/users", () => ({
  listAllTenantIds: vi.fn().mockResolvedValue([]),
}));

vi.mock("@server/tenancy/context", () => ({
  getActiveTenantId: vi.fn(() => "tenant-test"),
}));

vi.mock("./pdf-fingerprint", () => ({
  resolvePdfFingerprintContext: vi.fn().mockResolvedValue({}),
  getJobPdfFreshness: vi.fn((job: { pdfFingerprint?: string | null }) =>
    job.pdfFingerprint === "fresh" ? "current" : "stale",
  ),
}));

import {
  enqueueAutoPdfRegenerationForReadyJobs,
  enqueueStaleReadyPdfsForAllWorkspaces,
  shouldEnqueueTailoringAutoPdfRegeneration,
} from "./auto-pdf-regeneration";

describe("auto PDF regeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueue.mockResolvedValue({
      id: "queue-job-1",
      queue: "auto_pdf_regeneration",
      acceptedAt: "2026-05-04T10:00:00.000Z",
      deduplicated: false,
    });
    mocks.reserveNext.mockResolvedValue(null);
    mocks.acknowledge.mockResolvedValue(undefined);
    mocks.reject.mockResolvedValue(undefined);
    mocks.getReadyJobsWithGeneratedPdfs.mockResolvedValue([]);
  });

  it("re-renders stale ready PDFs after the CV in the editor changes", async () => {
    mocks.getReadyJobsWithGeneratedPdfs.mockResolvedValue([
      createJob({
        id: "job-1",
        status: "ready",
        pdfPath: "data/pdfs/job-1.pdf",
        pdfSource: "generated",
        pdfFingerprint: "stale",
      }),
      createJob({
        id: "job-2",
        status: "ready",
        pdfPath: "data/pdfs/job-2.pdf",
        pdfSource: "generated",
        pdfFingerprint: "stale",
      }),
    ]);

    const enqueued = await enqueueAutoPdfRegenerationForReadyJobs({
      reason: "design_resume_updated",
      requestedBy: "user",
    });

    expect(enqueued).toBe(2);
    expect(mocks.getReadyJobsWithGeneratedPdfs).toHaveBeenCalledWith(25, 0);
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
    expect(mocks.enqueue).toHaveBeenNthCalledWith(
      1,
      "auto_pdf_regeneration",
      expect.objectContaining({
        tenantId: "tenant-test",
        jobId: "job-1",
        reason: "design_resume_updated",
        requestedBy: "user",
      }),
      { dedupeKey: "tenant-test:job-1" },
    );
    expect(mocks.enqueue).toHaveBeenNthCalledWith(
      2,
      "auto_pdf_regeneration",
      expect.objectContaining({
        tenantId: "tenant-test",
        jobId: "job-2",
        reason: "design_resume_updated",
        requestedBy: "user",
      }),
      { dedupeKey: "tenant-test:job-2" },
    );
  });

  it("skips generated PDFs that are already current", async () => {
    mocks.getReadyJobsWithGeneratedPdfs.mockResolvedValue([
      createJob({
        id: "job-current",
        status: "ready",
        pdfPath: "data/pdfs/job-current.pdf",
        pdfSource: "generated",
        pdfFingerprint: "fresh",
      }),
      createJob({
        id: "job-stale",
        status: "ready",
        pdfPath: "data/pdfs/job-stale.pdf",
        pdfSource: "generated",
        pdfFingerprint: "stale",
      }),
    ]);

    const enqueued = await enqueueAutoPdfRegenerationForReadyJobs({
      reason: "design_resume_updated",
      requestedBy: "system",
    });

    expect(enqueued).toBe(1);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledWith(
      "auto_pdf_regeneration",
      expect.objectContaining({ jobId: "job-stale" }),
      { dedupeKey: "tenant-test:job-stale" },
    );
  });

  it("marks ready generated jobs stale when tailoring fields change", () => {
    const previous = createJob({
      status: "ready",
      pdfSource: "generated",
      tailoredSummary: "before",
    });
    const next = createJob({
      status: "ready",
      pdfSource: "generated",
      tailoredSummary: "after",
    });

    expect(shouldEnqueueTailoringAutoPdfRegeneration(previous, next)).toBe(
      true,
    );
  });

  it("ignores jobs that are not backed by generated PDFs", () => {
    const previous = createJob({
      status: "ready",
      pdfSource: "uploaded",
      tailoredSummary: "before",
    });
    const next = createJob({
      status: "ready",
      pdfSource: "uploaded",
      tailoredSummary: "after",
    });

    expect(shouldEnqueueTailoringAutoPdfRegeneration(previous, next)).toBe(
      false,
    );
  });

  it("re-queues outdated Ready PDFs of every workspace at startup", async () => {
    mocks.getReadyJobsWithGeneratedPdfs.mockResolvedValue([
      createJob({ id: "job-stale", status: "ready", pdfFingerprint: "old" }),
      createJob({ id: "job-fresh", status: "ready", pdfFingerprint: "fresh" }),
    ]);
    const total = await enqueueStaleReadyPdfsForAllWorkspaces(async () => [
      "tenant-a",
      "tenant-b",
    ]);
    expect(total).toBe(2);
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
    expect(
      mocks.enqueue.mock.calls.map(([, payload]) => [
        payload.jobId,
        payload.reason,
      ]),
    ).toEqual([
      ["job-stale", "startup"],
      ["job-stale", "startup"],
    ]);
  });
});
