/**
 * Test double for the Claude CLI: answers agent prompts with scripted
 * protocol replies so the real Deep Agents graph can run in unit tests.
 * Used only by tests.
 */
import type { ClaudeCliRunner } from "../chat-claude-cli";

export const SCRIPTED_PACK = {
  analysis: "Must-have: Python, SQL, data quality checks. Contract: CDI.",
  headline: "Data Quality Analyst (H/F)",
  emphasis: [
    { section: "Experience", guidance: "Lead with the validation work." },
  ],
  coverLetter: "Madame, Monsieur,\nJe souhaite rejoindre votre équipe.",
  coverLetterLanguage: "FR",
  critique: "VERDICT: ok after removing one unsupported claim.",
  unsupportedClaimsFixed: ['"led a team of 10"'],
  remainingRisks: ["No dbt experience on the CV."],
};

function called(prompt: string, toolName: string): number {
  return prompt.split(`"name":"${toolName}"`).length - 1;
}

function toolCalls(calls: Array<{ name: string; args?: unknown }>): string {
  return JSON.stringify({
    tool_calls: calls.map((call) => ({
      name: call.name,
      args: call.args ?? {},
    })),
  });
}

/** Replies like a well-behaved model for the application agent graph. */
export function scriptedApplicationReply(prompt: string): string {
  if (prompt.includes("You are the job-analyst")) {
    return called(prompt, "get_job") === 0
      ? toolCalls([{ name: "get_job" }])
      : JSON.stringify({ final: "Must-have: Python, SQL. Contract: CDI." });
  }
  if (prompt.includes("You are the cv-tailor")) {
    return called(prompt, "get_cv_profile") === 0
      ? toolCalls([
          { name: "get_job" },
          { name: "get_cv_profile" },
          { name: "get_tailoring_rules" },
        ])
      : JSON.stringify({
          final:
            "HEADLINE: Data Quality Analyst\nEMPHASIS:\n- Experience: validation work",
        });
  }
  if (prompt.includes("You are the cover-letter-writer")) {
    return called(prompt, "get_cv_profile") === 0
      ? toolCalls([
          { name: "get_job" },
          { name: "get_cv_profile" },
          { name: "get_learned_preferences" },
        ])
      : JSON.stringify({ final: "Madame, Monsieur, …\nLANGUAGE: fr" });
  }
  if (prompt.includes("You are the critic")) {
    return called(prompt, "get_cv_profile") === 0
      ? toolCalls([{ name: "get_cv_profile" }, { name: "get_tailoring_rules" }])
      : JSON.stringify({
          final:
            'UNSUPPORTED: "led a team of 10"\nRULES: none\nVERDICT: fix-needed',
        });
  }
  if (prompt.includes("You coordinate Boussole's application agents")) {
    const tasks = called(prompt, "task");
    if (tasks === 0) {
      return toolCalls([
        {
          name: "task",
          args: {
            subagent_type: "job-analyst",
            description: "Analyse the job posting.",
          },
        },
      ]);
    }
    if (tasks === 1) {
      return toolCalls([
        {
          name: "task",
          args: { subagent_type: "cv-tailor", description: "Tailor the CV." },
        },
        {
          name: "task",
          args: {
            subagent_type: "cover-letter-writer",
            description: "Write the letter.",
          },
        },
      ]);
    }
    if (tasks === 3) {
      return toolCalls([
        {
          name: "task",
          args: { subagent_type: "critic", description: "Check everything." },
        },
      ]);
    }
    if (called(prompt, "save_application_pack") === 0) {
      return toolCalls([
        { name: "save_application_pack", args: SCRIPTED_PACK },
      ]);
    }
    return JSON.stringify({ final: "Pack saved. Ready for review." });
  }
  throw new Error("Scripted CLI got an unexpected prompt");
}

export type ScriptedCli = {
  runner: ClaudeCliRunner;
  prompts: string[];
};

/** A runner that records prompts and answers with `reply(prompt)`. */
export function createScriptedCli(
  reply: (prompt: string) => string = scriptedApplicationReply,
): ScriptedCli {
  const prompts: string[] = [];
  const runner: ClaudeCliRunner = async ({ prompt, signal }) => {
    if (signal?.aborted) throw new Error("Claude CLI invocation was aborted.");
    prompts.push(prompt);
    return reply(prompt);
  };
  return { runner, prompts };
}
