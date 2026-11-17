// @vitest-environment node
import { createDefaultDesignResumeAiGuidance } from "@shared/design-resume-ai-guidance";
import { createJob } from "@shared/testing/factories";
import type { ResumeProfile } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  buildApplicationTools,
  buildJobBrief,
  buildTailoringRulesText,
  runApplicationAgent,
} from "./application-agent";
import { ChatClaudeCli } from "./chat-claude-cli";
import { type AgentEventInput, AgentProgressHandler } from "./progress";
import { createScriptedCli, SCRIPTED_PACK } from "./testing/scripted-cli";

function buildProfile(): ResumeProfile {
  const aiGuidance = createDefaultDesignResumeAiGuidance();
  aiGuidance.sections.headline.prefix = "Junior";
  aiGuidance.sections.summary.mode = "keep";
  aiGuidance.sections.references.share = false;
  return {
    basics: {
      name: "Candidate",
      email: "candidate@example.com",
      phone: "+33 6 00 00 00 00",
      headline: "Stagiaire Conformité IA",
      location: { address: "12 rue de Rivoli, 75001 Paris" },
    },
    sections: {
      summary: { content: "<p>QA engineer moving into data quality.</p>" },
      experience: {
        items: [
          {
            id: "exp-1",
            company: "KPIT",
            position: "Test & Validation Engineer",
            summary: "<p>Automated validation of embedded software.</p>",
          },
        ],
      },
      references: {
        items: [{ id: "ref-1", name: "Private Referee" }],
      },
    },
    aiGuidance,
  } as unknown as ResumeProfile;
}

const job = createJob({
  id: "job-dq",
  title: "Data Quality Analyst (H/F)",
  employer: "Acme",
  location: "Paris, France",
  jobType: "Full-time permanent (CDI)",
  jobDescription:
    "Nous cherchons un(e) analyste qualité des données. Python, SQL.",
});

describe("application agent tools", () => {
  it("hands the agents only the job posting fields and the AI view of the CV", async () => {
    const sink = { pack: null };
    const tools = buildApplicationTools(
      { job, profile: buildProfile(), preferences: null },
      sink,
    );

    const cv = String(await tools.getCvProfile.invoke({}));
    expect(cv).toContain("Test & Validation Engineer");
    expect(cv).not.toContain("candidate@example.com");
    expect(cv).not.toContain("+33 6");
    expect(cv).not.toContain("rue de Rivoli");
    expect(cv).not.toContain("Private Referee");

    expect(String(await tools.getLearnedPreferences.invoke({}))).toBe(
      "No learned preferences yet.",
    );
    const brief = JSON.parse(buildJobBrief(job));
    expect(brief).toMatchObject({
      title: "Data Quality Analyst (H/F)",
      contract: "Full-time permanent (CDI)",
    });
    expect(brief).not.toHaveProperty("jobUrl");
  });

  it("states the tailoring rules, including locked text", () => {
    const text = buildTailoringRulesText(buildProfile());
    expect(text).toContain('must start with "Junior"');
    expect(text).toContain(
      'Current summary (locked, keep word for word): "QA engineer moving into data quality."',
    );
  });
});

describe("runApplicationAgent", () => {
  it("chains the subagents through the task tool and saves an enforced pack", async () => {
    const cli = createScriptedCli();
    const events: AgentEventInput[] = [];
    const handler = new AgentProgressHandler((event) => events.push(event));

    const pack = await runApplicationAgent({
      input: { job, profile: buildProfile(), preferences: "## Prefers\n- CDI" },
      model: new ChatClaudeCli({ runner: cli.runner }),
      signal: new AbortController().signal,
      callbacks: [handler],
    });

    // Headline: gender marker stripped, candidate prefix applied.
    expect(pack.headline).toBe("Junior Data Quality Analyst");
    expect(pack.coverLetterLanguage).toBe("fr");
    expect(pack.unsupportedClaimsFixed).toEqual(
      SCRIPTED_PACK.unsupportedClaimsFixed,
    );

    const started = events
      .filter((event) => event.type === "subagent_started")
      .map((event) => event.agent);
    expect(started).toEqual(
      expect.arrayContaining([
        "job-analyst",
        "cv-tailor",
        "cover-letter-writer",
        "critic",
      ]),
    );
    expect(started).toHaveLength(4);
    expect(started[0]).toBe("job-analyst");
    expect(started[3]).toBe("critic");
    expect(
      events.filter((event) => event.type === "subagent_finished"),
    ).toHaveLength(4);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_called",
        agent: "orchestrator",
        label: "orchestrator called save_application_pack",
      }),
    );

    // orchestrator 5 turns + 2 per subagent.
    expect(cli.prompts).toHaveLength(13);
    for (const prompt of cli.prompts) {
      expect(prompt).not.toContain("candidate@example.com");
      expect(prompt).not.toContain("Private Referee");
    }
    expect(
      cli.prompts.some((prompt) =>
        prompt.includes("### Tool result (get_learned_preferences"),
      ),
    ).toBe(true);
  });

  it("fails when the agents never save a pack", async () => {
    const cli = createScriptedCli((prompt) =>
      prompt.includes("You coordinate Boussole's application agents")
        ? JSON.stringify({ final: "I could not do it." })
        : JSON.stringify({ final: "n/a" }),
    );
    await expect(
      runApplicationAgent({
        input: { job, profile: buildProfile(), preferences: null },
        model: new ChatClaudeCli({ runner: cli.runner }),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("finished without saving an application pack");
  });

  it("stops when the run is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const cli = createScriptedCli();
    await expect(
      runApplicationAgent({
        input: { job, profile: buildProfile(), preferences: null },
        model: new ChatClaudeCli({ runner: cli.runner }),
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(cli.prompts).toHaveLength(0);
  });
});
