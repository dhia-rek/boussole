import { KEYWORD_ESTIMATE_REASON } from "@shared/scoring";
import { describe, expect, it } from "vitest";
import {
  chooseCandidates,
  computeNextSteps,
  type GuideInput,
  type GuideJob,
  nextApplyStep,
} from "./next-steps";

const NOW = new Date("2026-11-18T12:00:00.000Z");
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString();

function job(overrides: Partial<GuideJob>): GuideJob {
  return {
    id: "job",
    title: "Data Engineer",
    employer: "Acme",
    status: "ready",
    score: 80,
    reason: "Strong match for data quality.",
    discoveredAt: daysAgo(2),
    updatedAt: daysAgo(1),
    appliedAt: null,
    latestStage: null,
    lastEventAt: null,
    followedUp: false,
    prep: { cvCheck: false, research: false, message: false },
    lastPrepAt: null,
    ...overrides,
  };
}

function input(overrides: Partial<GuideInput>): GuideInput {
  return {
    hasCv: true,
    searchRunning: false,
    lastSearchAt: daysAgo(1),
    unfinishedSearchAt: null,
    jobs: [],
    ...overrides,
  };
}

describe("guided next steps", () => {
  it("handles a stale workspace: search first, then fix estimates; old internships are not suggested", () => {
    const steps = computeNextSteps(
      input({
        lastSearchAt: daysAgo(148),
        jobs: [
          job({
            id: "old-intern",
            title: "Data Science Intern",
            score: 98,
            discoveredAt: daysAgo(180),
          }),
          job({
            id: "est-1",
            score: 75,
            reason: KEYWORD_ESTIMATE_REASON,
            discoveredAt: daysAgo(10),
          }),
          job({
            id: "est-2",
            status: "discovered",
            score: 80,
            reason: "Scored using keyword matching (API key not configured)",
            discoveredAt: daysAgo(12),
          }),
          // Old estimates are not worth an AI call each.
          job({
            id: "est-old",
            reason: KEYWORD_ESTIMATE_REASON,
            discoveredAt: daysAgo(170),
          }),
        ],
      }),
      NOW,
    );
    expect(steps.map((step) => step.kind)).toEqual([
      "find_jobs",
      "recalculate_scores",
    ]);
    expect(steps[0]).toMatchObject({
      title: "Find new jobs",
      detail: expect.stringContaining("5 months ago"),
      cta: { href: "/jobs/ready?run=automatic" },
    });
    expect(steps[1]).toMatchObject({
      title: "Recalculate 2 match scores",
      cta: { action: "recalculate", jobIds: ["est-1", "est-2"] },
    });
  });

  it("puts interviews and follow-ups before everything else", () => {
    const steps = computeNextSteps(
      input({
        jobs: [
          job({ id: "fresh", score: 85 }),
          job({
            id: "applied-10",
            employer: "Alan",
            status: "applied",
            appliedAt: daysAgo(10),
            latestStage: "applied",
          }),
          job({ id: "applied-3", status: "applied", appliedAt: daysAgo(3) }),
          job({ id: "applied-45", status: "applied", appliedAt: daysAgo(45) }),
          job({
            id: "interview",
            employer: "SII",
            status: "in_progress",
            latestStage: "technical_interview",
          }),
        ],
      }),
      NOW,
    );
    expect(steps.map((step) => step.kind)).toEqual([
      "prepare_interview",
      "follow_up",
      "choose_job",
    ]);
    expect(steps[0]).toMatchObject({
      title: "Prepare your technical interview with SII",
      cta: { href: "/interview/interview" },
    });
    expect(steps[1]).toMatchObject({
      title: "Follow up with Alan",
      detail: expect.stringContaining("10 days ago"),
    });
    expect(steps[1]?.cta.href).toMatch(
      /^\/job\/applied-10\/ghostwriter\?prompt=/,
    );
    expect(steps[1]?.secondary).toEqual({
      label: "I've sent it",
      action: "log_follow_up",
    });
  });

  it("stops asking for a follow-up once it is sent or something happened", () => {
    const applied = { status: "applied" as const, appliedAt: daysAgo(12) };
    const kinds = (jobs: GuideJob[]) =>
      computeNextSteps(input({ jobs }), NOW).map((step) => step.kind);
    expect(kinds([job({ ...applied })])).toEqual(["follow_up"]);
    expect(kinds([job({ ...applied, followedUp: true })])).toEqual([
      "caught_up",
    ]);
    // A note logged 2 days ago: not quiet for a week yet.
    expect(kinds([job({ ...applied, lastEventAt: daysAgo(2) })])).toEqual([
      "caught_up",
    ]);
  });

  it("resumes an application at its first missing step", () => {
    const started = job({
      id: "sii",
      employer: "Groupe SII",
      prep: { cvCheck: true, research: false, message: false },
      lastPrepAt: daysAgo(1),
    });
    expect(nextApplyStep(started)).toBe("company");
    const steps = computeNextSteps(input({ jobs: [started] }), NOW);
    expect(steps[0]).toMatchObject({
      kind: "continue_application",
      title: "Finish your application to Groupe SII",
      detail: expect.stringContaining("step 3 of 5"),
      cta: { href: "/apply/sii?step=company" },
    });
    expect(
      nextApplyStep(
        job({ prep: { cvCheck: true, research: true, message: true } }),
      ),
    ).toBe("send");
    // Untouched for 2 weeks: no longer pushed.
    const abandoned = { ...started, lastPrepAt: daysAgo(20) };
    expect(computeNextSteps(input({ jobs: [abandoned] }), NOW)[0]?.kind).toBe(
      "caught_up",
    );
  });

  it("only suggests fresh, AI-scored, good matches nobody started", () => {
    const candidates = chooseCandidates(
      [
        job({ id: "good", score: 72 }),
        job({ id: "best", score: 90 }),
        job({ id: "weak", score: 40 }),
        job({ id: "estimate", score: 95, reason: KEYWORD_ESTIMATE_REASON }),
        job({ id: "old", score: 99, discoveredAt: daysAgo(60) }),
        job({
          id: "started",
          score: 88,
          prep: { cvCheck: true, research: false, message: false },
        }),
        job({ id: "applied", score: 93, status: "applied" }),
      ],
      NOW,
    );
    expect(candidates.map((c) => c.id)).toEqual(["best", "good"]);
  });

  it("asks for a CV first, reports a running search, and says when all is done", () => {
    expect(computeNextSteps(input({ hasCv: false }), NOW)[0]?.kind).toBe(
      "add_cv",
    );
    expect(
      computeNextSteps(
        input({ searchRunning: true, lastSearchAt: daysAgo(30) }),
        NOW,
      ).map((s) => s.kind),
    ).toEqual(["search_running"]);
    expect(computeNextSteps(input({}), NOW)).toEqual([
      expect.objectContaining({ kind: "caught_up" }),
    ]);
  });

  it("says when the last search didn't finish", () => {
    const [step] = computeNextSteps(
      input({ lastSearchAt: daysAgo(148), unfinishedSearchAt: daysAgo(0) }),
      NOW,
    );
    expect(step).toMatchObject({
      kind: "find_jobs",
      title: "Run your search again",
      detail:
        "Your last search (today) didn't finish. Your last complete search was 5 months ago. New postings appear every day, and older ones close.",
    });
    // Even right after a complete search, a newer cut-off one is worth redoing.
    expect(
      computeNextSteps(
        input({ lastSearchAt: daysAgo(2), unfinishedSearchAt: daysAgo(1) }),
        NOW,
      )[0]?.title,
    ).toBe("Run your search again");
  });

  it("never lists more than four steps", () => {
    const jobs = Array.from({ length: 8 }, (_, i) =>
      job({ id: `a${i}`, status: "applied", appliedAt: daysAgo(8 + i) }),
    );
    expect(computeNextSteps(input({ jobs }), NOW)).toHaveLength(4);
  });
});
