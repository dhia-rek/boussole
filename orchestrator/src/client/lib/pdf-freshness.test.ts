import { describe, expect, it } from "vitest";
import {
  getPdfActionLabels,
  getPdfFreshness,
  isPdfRegenerating,
  isPdfStale,
  PDF_REGENERATING_MESSAGE,
  STALE_PDF_MESSAGE,
} from "./pdf-freshness";

describe("getPdfFreshness", () => {
  it("returns 'regenerating' when pdfRegenerating is true, regardless of pdfFreshness", () => {
    expect(
      getPdfFreshness({ pdfRegenerating: true, pdfFreshness: "current" }),
    ).toBe("regenerating");
  });

  it("returns pdfFreshness when not regenerating", () => {
    expect(
      getPdfFreshness({ pdfRegenerating: false, pdfFreshness: "stale" }),
    ).toBe("stale");
    expect(
      getPdfFreshness({ pdfRegenerating: false, pdfFreshness: "current" }),
    ).toBe("current");
  });

  it("returns 'missing' when pdfFreshness is 'missing' and not regenerating", () => {
    expect(
      getPdfFreshness({ pdfRegenerating: false, pdfFreshness: "missing" }),
    ).toBe("missing");
  });

  it("returns 'missing' for null input", () => {
    expect(getPdfFreshness(null)).toBe("missing");
  });

  it("returns 'missing' for undefined input", () => {
    expect(getPdfFreshness(undefined)).toBe("missing");
  });
});

describe("isPdfStale", () => {
  it("returns true when freshness is stale and not regenerating", () => {
    expect(isPdfStale({ pdfRegenerating: false, pdfFreshness: "stale" })).toBe(
      true,
    );
  });

  it("returns false when regenerating even if freshness would be stale", () => {
    expect(isPdfStale({ pdfRegenerating: true, pdfFreshness: "stale" })).toBe(
      false,
    );
  });

  it("returns false when fresh", () => {
    expect(
      isPdfStale({ pdfRegenerating: false, pdfFreshness: "current" }),
    ).toBe(false);
  });

  it("returns false for null input", () => {
    expect(isPdfStale(null)).toBe(false);
  });
});

describe("isPdfRegenerating", () => {
  it("returns true when pdfRegenerating is true", () => {
    expect(
      isPdfRegenerating({ pdfRegenerating: true, pdfFreshness: "missing" }),
    ).toBe(true);
  });

  it("returns false when not regenerating", () => {
    expect(
      isPdfRegenerating({ pdfRegenerating: false, pdfFreshness: "current" }),
    ).toBe(false);
  });

  it("returns false for null input", () => {
    expect(isPdfRegenerating(null)).toBe(false);
  });
});

describe("getPdfActionLabels", () => {
  it("returns 'old PDF' labels when stale", () => {
    const labels = getPdfActionLabels({
      pdfRegenerating: false,
      pdfFreshness: "stale",
    });
    expect(labels.view).toBe("View old PDF");
    expect(labels.download).toBe("Download old PDF");
  });

  it("returns normal labels when current", () => {
    const labels = getPdfActionLabels({
      pdfRegenerating: false,
      pdfFreshness: "current",
    });
    expect(labels.view).toBe("View PDF");
    expect(labels.download).toBe("Download PDF");
  });

  it("returns normal labels when regenerating (not stale)", () => {
    const labels = getPdfActionLabels({
      pdfRegenerating: true,
      pdfFreshness: "stale",
    });
    expect(labels.view).toBe("View PDF");
    expect(labels.download).toBe("Download PDF");
  });

  it("returns normal labels for null input", () => {
    const labels = getPdfActionLabels(null);
    expect(labels.view).toBe("View PDF");
    expect(labels.download).toBe("Download PDF");
  });
});

describe("message constants", () => {
  it("STALE_PDF_MESSAGE is non-empty", () => {
    expect(STALE_PDF_MESSAGE.length).toBeGreaterThan(0);
  });

  it("PDF_REGENERATING_MESSAGE is non-empty", () => {
    expect(PDF_REGENERATING_MESSAGE.length).toBeGreaterThan(0);
  });
});
