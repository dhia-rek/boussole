import { createJob } from "@shared/testing/factories";
import { describe, expect, it, vi } from "vitest";

vi.mock("./design-resume", () => ({
  getCurrentDesignResumeOrNullOnLegacy: vi.fn(),
}));

import { getCurrentDesignResumeOrNullOnLegacy } from "./design-resume";
import type { PdfFingerprintContext } from "./pdf-fingerprint";
import {
  createJobPdfFingerprint,
  getJobPdfFreshness,
  resolvePdfFingerprintContext,
} from "./pdf-fingerprint";

const context: PdfFingerprintContext = {
  version: "v2",
  designResumeDocumentId: "design-resume-1",
  designResumeRevision: 2,
  designResumeUpdatedAt: "2026-05-01T10:00:00.000Z",
};

describe("PDF freshness", () => {
  it("maps missing PDFs to missing", () => {
    expect(getJobPdfFreshness(createJob(), context)).toBe("missing");
  });

  it("maps uploaded PDFs to uploaded", () => {
    expect(
      getJobPdfFreshness(
        createJob({
          pdfPath: "data/pdfs/uploaded.pdf",
          pdfSource: "uploaded",
        }),
        context,
      ),
    ).toBe("uploaded");
  });

  it("maps active PDF generation to regenerating", () => {
    expect(
      getJobPdfFreshness(
        createJob({
          pdfPath: "data/pdfs/generated.pdf",
          pdfSource: "generated",
          pdfRegenerating: true,
        }),
        context,
      ),
    ).toBe("regenerating");
  });

  it("maps generated PDFs with matching fingerprints to current", () => {
    const job = createJob({
      pdfPath: "data/pdfs/generated.pdf",
      pdfSource: "generated",
      tailoredSummary: "Summary",
    });
    const pdfFingerprint = createJobPdfFingerprint(job, context);

    expect(getJobPdfFreshness({ ...job, pdfFingerprint }, context)).toBe(
      "current",
    );
  });

  it("maps generated PDFs with mismatched fingerprints to stale", () => {
    expect(
      getJobPdfFreshness(
        createJob({
          pdfPath: "data/pdfs/generated.pdf",
          pdfSource: "generated",
          pdfFingerprint: "old-fingerprint",
        }),
        context,
      ),
    ).toBe("stale");
  });

  it("treats legacy PDFs without a source as generated for freshness", () => {
    expect(
      getJobPdfFreshness(
        createJob({
          pdfPath: "data/pdfs/legacy-generated.pdf",
          pdfSource: null,
          pdfFingerprint: "old-fingerprint",
        }),
        context,
      ),
    ).toBe("stale");
  });

  it("marks generated PDFs stale once the CV in the editor changes", () => {
    const job = createJob({
      pdfPath: "data/pdfs/generated.pdf",
      pdfSource: "generated",
      tailoredSummary: "Summary",
    });
    const pdfFingerprint = createJobPdfFingerprint(job, context);

    expect(
      getJobPdfFreshness(
        { ...job, pdfFingerprint },
        {
          ...context,
          designResumeRevision: 3,
          designResumeUpdatedAt: "2026-05-02T10:00:00.000Z",
        },
      ),
    ).toBe("stale");
  });
});

describe("resolvePdfFingerprintContext", () => {
  it("fingerprints against the current CV editor document", async () => {
    vi.mocked(getCurrentDesignResumeOrNullOnLegacy).mockResolvedValue({
      id: "design-resume-1",
      revision: 2,
      updatedAt: "2026-05-01T10:00:00.000Z",
    } as never);

    await expect(resolvePdfFingerprintContext()).resolves.toEqual(context);
  });

  it("uses empty CV fields when the editor has no CV yet", async () => {
    vi.mocked(getCurrentDesignResumeOrNullOnLegacy).mockResolvedValue(null);

    await expect(resolvePdfFingerprintContext()).resolves.toEqual({
      version: "v2",
      designResumeDocumentId: null,
      designResumeRevision: null,
      designResumeUpdatedAt: null,
    });
  });
});
