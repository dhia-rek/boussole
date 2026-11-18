import { describe, expect, it } from "vitest";
import { formatCrawlingMessage } from "./progress";

const base = {
  crawlingTermsProcessed: 0,
  crawlingTermsTotal: 0,
  crawlingListPagesProcessed: 0,
  crawlingListPagesTotal: 0,
  crawlingJobPagesProcessed: 0,
  crawlingJobPagesEnqueued: 0,
  crawlingJobPagesSkipped: 0,
  crawlingJobCardsFound: 0,
};

describe("formatCrawlingMessage", () => {
  it("never shows an impossible fraction", () => {
    expect(
      formatCrawlingMessage({
        ...base,
        crawlingTermsProcessed: 145,
        crawlingTermsTotal: 188,
        crawlingListPagesProcessed: 10,
        crawlingListPagesTotal: 9,
        crawlingJobPagesProcessed: 50,
        crawlingJobPagesEnqueued: 5,
        crawlingJobCardsFound: 87916,
      }),
    ).toBe(
      "Searching job sites (search terms 145/188, result pages 10, job pages 50, 87,916 listings scanned)...",
    );
  });

  it("keeps real fractions", () => {
    expect(
      formatCrawlingMessage({
        ...base,
        crawlingListPagesProcessed: 3,
        crawlingListPagesTotal: 9,
        crawlingJobPagesProcessed: 4,
        crawlingJobPagesEnqueued: 12,
        crawlingJobPagesSkipped: 2,
      }),
    ).toBe(
      "Searching job sites (result pages 3/9, job pages 4/12, 2 skipped)...",
    );
  });
});
