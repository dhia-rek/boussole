import { describe, expect, it, vi } from "vitest";
import { InMemoryJobQueue } from "./job-queue-memory";

describe("InMemoryJobQueue", () => {
  it("enqueues auto pdf regeneration jobs", async () => {
    const queue = new InMemoryJobQueue();

    const result = await queue.enqueue("auto_pdf_regeneration", {
      tenantId: "tenant-test",
      jobId: "job-1",
      reason: "design_resume_updated",
      requestedAt: "2026-05-04T10:00:00.000Z",
      requestedBy: "system",
    });

    expect(result.queue).toBe("auto_pdf_regeneration");
    expect(result.deduplicated).toBe(false);
    expect(result.id).toBeTruthy();

    const jobs = queue.getQueuedJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload.jobId).toBe("job-1");
  });

  it("deduplicates by queue and dedupe key", async () => {
    const queue = new InMemoryJobQueue();

    const first = await queue.enqueue(
      "auto_pdf_regeneration",
      {
        tenantId: "tenant-test",
        jobId: "job-1",
        reason: "tailoring_updated",
        requestedAt: "2026-05-04T10:00:00.000Z",
        requestedBy: "user",
      },
      { dedupeKey: "job-1:auto-pdf" },
    );

    const second = await queue.enqueue(
      "auto_pdf_regeneration",
      {
        tenantId: "tenant-test",
        jobId: "job-1",
        reason: "manual_refresh",
        requestedAt: "2026-05-04T10:01:00.000Z",
        requestedBy: "user",
      },
      { dedupeKey: "job-1:auto-pdf" },
    );

    expect(first.id).toBe(second.id);
    expect(second.deduplicated).toBe(true);
    expect(queue.getQueuedJobs()).toHaveLength(1);
  });

  it("allows re-enqueue after reserved job is acknowledged", async () => {
    const queue = new InMemoryJobQueue();

    const first = await queue.enqueue(
      "auto_pdf_regeneration",
      {
        tenantId: "tenant-test",
        jobId: "job-1",
        reason: "tailoring_updated",
        requestedAt: "2026-05-04T10:00:00.000Z",
        requestedBy: "system",
      },
      { dedupeKey: "job-1:auto-pdf" },
    );

    const reserved = await queue.reserveNext("auto_pdf_regeneration");
    expect(reserved?.id).toBe(first.id);

    await queue.acknowledge(first.id);

    const next = await queue.enqueue(
      "auto_pdf_regeneration",
      {
        tenantId: "tenant-test",
        jobId: "job-1",
        reason: "tailoring_updated",
        requestedAt: "2026-05-04T10:02:00.000Z",
        requestedBy: "system",
      },
      { dedupeKey: "job-1:auto-pdf" },
    );

    expect(next.deduplicated).toBe(false);
    expect(next.id).not.toBe(first.id);
  });

  it("queues a duplicate behind a job that is already running", async () => {
    const queue = new InMemoryJobQueue();
    const payload = (requestedAt: string) => ({
      tenantId: "tenant-test",
      jobId: "job-1",
      reason: "tailoring_updated" as const,
      requestedAt,
      requestedBy: "system" as const,
    });
    const first = await queue.enqueue(
      "auto_pdf_regeneration",
      payload("2026-05-04T10:00:00.000Z"),
      { dedupeKey: "job-1:auto-pdf" },
    );
    expect((await queue.reserveNext("auto_pdf_regeneration"))?.id).toBe(
      first.id,
    );

    // New tailoring arrives while the first rebuild renders older content.
    const second = await queue.enqueue(
      "auto_pdf_regeneration",
      payload("2026-05-04T10:00:05.000Z"),
      { dedupeKey: "job-1:auto-pdf" },
    );
    expect(second.deduplicated).toBe(false);

    // A third request while the second still waits is absorbed by it.
    const third = await queue.enqueue(
      "auto_pdf_regeneration",
      payload("2026-05-04T10:00:06.000Z"),
      { dedupeKey: "job-1:auto-pdf" },
    );
    expect(third).toMatchObject({ deduplicated: true, id: second.id });

    // Finishing the first must not erase the waiting second's de-dup entry.
    await queue.acknowledge(first.id);
    const fourth = await queue.enqueue(
      "auto_pdf_regeneration",
      payload("2026-05-04T10:00:07.000Z"),
      { dedupeKey: "job-1:auto-pdf" },
    );
    expect(fourth).toMatchObject({ deduplicated: true, id: second.id });
    expect((await queue.reserveNext("auto_pdf_regeneration"))?.id).toBe(
      second.id,
    );
  });

  it("does not reserve delayed jobs before they are available", async () => {
    vi.useFakeTimers();
    try {
      const queue = new InMemoryJobQueue();

      await queue.enqueue(
        "auto_pdf_regeneration",
        {
          tenantId: "tenant-test",
          jobId: "job-delayed",
          reason: "settings_changed",
          requestedAt: "2026-05-04T10:00:00.000Z",
          requestedBy: "system",
        },
        { delayMs: 1000 },
      );

      expect(await queue.reserveNext("auto_pdf_regeneration")).toBeNull();

      vi.advanceTimersByTime(1000);

      const reserved = await queue.reserveNext("auto_pdf_regeneration");
      expect(reserved?.payload.jobId).toBe("job-delayed");
    } finally {
      vi.useRealTimers();
    }
  });
});
