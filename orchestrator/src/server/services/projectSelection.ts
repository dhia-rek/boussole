/**
 * Service for AI-powered project selection for resumes.
 */

import type { DesignResumeAiGuidance } from "@shared/types";
import { getItemNotes } from "./ai-profile-context";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";
import {
  type ResumeProjectSelectionItem,
  resolveProjectSelectionPlan,
} from "./resumeProjects";

type SelectableProject = ResumeProjectSelectionItem & { aiNotes?: string };

/** JSON schema for project selection response */
const PROJECT_SELECTION_SCHEMA: JsonSchemaDefinition = {
  name: "project_selection",
  schema: {
    type: "object",
    properties: {
      selectedProjectIds: {
        type: "array",
        items: { type: "string" },
        description: "List of project IDs to include on the resume",
      },
    },
    required: ["selectedProjectIds"],
    additionalProperties: false,
  },
};

/**
 * Chooses the projects for one tailored CV: honors the candidate's section
 * lock and per-project pins, then lets the AI fill the remaining slots.
 * Returns ids in the CV's own project order.
 */
export async function selectProjectIdsForJob(args: {
  jobDescription: string;
  selectionItems: ResumeProjectSelectionItem[];
  overrideRaw: string | null;
  guidance?: DesignResumeAiGuidance | null;
}): Promise<string[]> {
  const plan = resolveProjectSelectionPlan({
    catalog: args.selectionItems,
    overrideRaw: args.overrideRaw,
    guidance: args.guidance,
  });
  if (plan.mode === "keep") return plan.selectedIds;

  const eligible = new Set(plan.eligibleIds);
  const shareProjects = args.guidance?.sections.projects.share !== false;
  const eligibleProjects: SelectableProject[] = args.selectionItems
    .filter((project) => eligible.has(project.id))
    .map((project) => {
      const aiNotes = shareProjects
        ? getItemNotes(args.guidance, project.id)
        : "";
      return aiNotes ? { ...project, aiNotes } : project;
    });

  const picked = await pickProjectIdsForJob({
    jobDescription: args.jobDescription,
    eligibleProjects,
    desiredCount: plan.desiredCount,
    sectionNotes: shareProjects
      ? (args.guidance?.sections.projects.notes ?? "").trim()
      : "",
  });

  const chosen = new Set([...plan.lockedIds, ...picked]);
  return args.selectionItems
    .map((project) => project.id)
    .filter((id) => chosen.has(id));
}

export async function pickProjectIdsForJob(args: {
  jobDescription: string;
  eligibleProjects: SelectableProject[];
  desiredCount: number;
  sectionNotes?: string;
}): Promise<string[]> {
  const desiredCount = Math.max(0, Math.floor(args.desiredCount));
  if (desiredCount === 0) return [];

  const eligibleIds = new Set(args.eligibleProjects.map((p) => p.id));
  if (eligibleIds.size === 0) return [];

  const model = await resolveLlmModel("projectSelection");

  const prompt = buildProjectSelectionPrompt({
    jobDescription: args.jobDescription,
    projects: args.eligibleProjects,
    desiredCount,
    sectionNotes: args.sectionNotes ?? "",
  });

  const llm = await createConfiguredLlmService();
  const result = await llm.callJson<{ selectedProjectIds: string[] }>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: PROJECT_SELECTION_SCHEMA,
  });

  if (!result.success) {
    return fallbackPickProjectIds(
      args.jobDescription,
      args.eligibleProjects,
      desiredCount,
    );
  }

  const selectedProjectIds = Array.isArray(result.data?.selectedProjectIds)
    ? result.data.selectedProjectIds
    : [];

  // Validate and dedupe the returned IDs
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of selectedProjectIds) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!trimmed) continue;
    if (!eligibleIds.has(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
    if (unique.length >= desiredCount) break;
  }

  if (unique.length === 0) {
    return fallbackPickProjectIds(
      args.jobDescription,
      args.eligibleProjects,
      desiredCount,
    );
  }

  return unique;
}

function buildProjectSelectionPrompt(args: {
  jobDescription: string;
  projects: SelectableProject[];
  desiredCount: number;
  sectionNotes: string;
}): string {
  const projects = args.projects.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    date: p.date,
    summary: truncate(p.summaryText, 500),
    ...(p.aiNotes ? { candidateNote: truncate(p.aiNotes, 500) } : {}),
  }));
  const notesLine = args.sectionNotes
    ? `\n- The candidate's guidance for choosing projects: ${truncate(args.sectionNotes, 1000)}`
    : "";

  return `
You are selecting which projects to include on a resume for a specific job.

Rules:
- Choose up to ${args.desiredCount} project IDs.
- Only choose IDs from the provided list.
- Prefer projects that strongly match the job description keywords/tech stack.
- Prefer projects that signal impact and real-world engineering.
- "candidateNote" fields are the candidate's own hints about a project; weigh them.
- Do NOT invent projects or skills.${notesLine}

Job description:
${args.jobDescription}

Candidate projects (pick from these IDs only):
${JSON.stringify(projects, null, 2)}

Respond with JSON only, in this exact shape:
{
  "selectedProjectIds": ["id1", "id2"]
}
`.trim();
}

const FALLBACK_STOPWORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "you",
  "our",
  "your",
  "are",
  "will",
  "from",
  "this",
  "that",
  "have",
  "has",
  "les",
  "des",
  "une",
  "pour",
  "avec",
  "dans",
  "sur",
  "par",
  "est",
  "vous",
  "nous",
  "aux",
  "qui",
  "que",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9+#.]+/)
      .map((token) => token.replace(/^\.+|\.+$/g, ""))
      .filter((token) => token.length >= 2 && !FALLBACK_STOPWORDS.has(token)),
  );
}

/**
 * Deterministic fallback when the LLM is unavailable: rank projects by how
 * many distinct job-description terms their text (and the candidate's note)
 * shares. Domain-agnostic, so it works for AI/data roles as well as web ones.
 */
function fallbackPickProjectIds(
  jobDescription: string,
  eligibleProjects: SelectableProject[],
  desiredCount: number,
): string[] {
  const jdTokens = tokenize(jobDescription || "");

  const scored = eligibleProjects
    .map((p, index) => {
      const projectTokens = tokenize(
        `${p.name} ${p.description} ${p.summaryText} ${p.aiNotes ?? ""}`,
      );
      let score = 0;
      for (const token of projectTokens) {
        if (jdTokens.has(token)) score += token.length >= 4 ? 2 : 1;
      }
      return { id: p.id, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return scored.slice(0, desiredCount).map((s) => s.id);
}

function truncate(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars - 1).trimEnd()}…`;
}
