/**
 * Service for generating tailored resume content (Summary, Headline, Skills).
 */

import { logger } from "@infra/logger";
import {
  applyDesignResumeHeadlinePrefix,
  stripJobTitleGenderMarkers,
} from "@shared/design-resume-ai-guidance";
import type { ResumeProfile } from "@shared/types";
import { htmlToPlainText } from "@shared/utils/string";
import {
  buildAiProfileView,
  formatCandidateNotes,
  formatTailoringRulesForPrompt,
  resolveTailoringRules,
  type TailoringRules,
} from "./ai-profile-context";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";
import {
  detectLanguageFromText,
  detectProfileLanguage,
  getWritingLanguageLabel,
  resolveWritingOutputLanguage,
} from "./output-language";
import {
  getEffectivePromptTemplate,
  renderPromptTemplate,
} from "./prompt-templates";
import {
  getWritingStyle,
  stripKeywordLimitFromConstraints,
  stripLanguageDirectivesFromConstraints,
  stripWordLimitFromConstraints,
} from "./writing-style";

export interface TailoredData {
  summary: string;
  headline: string;
  skills: Array<{ name: string; keywords: string[] }>;
}

export interface TailoringResult {
  success: boolean;
  data?: TailoredData;
  error?: string;
}

/** JSON schema for resume tailoring response */
const TAILORING_SCHEMA: JsonSchemaDefinition = {
  name: "resume_tailoring",
  schema: {
    type: "object",
    properties: {
      headline: {
        type: "string",
        description: "Job title headline matching the JD exactly",
      },
      summary: {
        type: "string",
        description: "Tailored resume summary paragraph",
      },
      skills: {
        type: "array",
        description: "Skills sections with keywords tailored to the job",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Skill category name (e.g., Frontend, Backend)",
            },
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "List of skills/technologies in this category",
            },
          },
          required: ["name", "keywords"],
          additionalProperties: false,
        },
      },
    },
    required: ["headline", "summary", "skills"],
    additionalProperties: false,
  },
};

/**
 * The candidate's own headline/summary/skills, in the plain-text shape the
 * tailoring editor uses. Returned for sections the candidate locked.
 */
export function getOriginalTailoringValues(
  profile: ResumeProfile,
): TailoredData {
  const summaryHtml =
    profile.sections?.summary?.content || profile.basics?.summary || "";
  const skills = (profile.sections?.skills?.items ?? [])
    .filter((item) => item && item.visible !== false)
    .map((item) => ({
      name: item.name ?? "",
      keywords: Array.isArray(item.keywords)
        ? item.keywords.filter(
            (keyword): keyword is string => typeof keyword === "string",
          )
        : [],
    }))
    .filter((item) => item.name || item.keywords.length > 0);
  return {
    headline: (profile.basics?.headline || profile.basics?.label || "").trim(),
    summary: htmlToPlainText(summaryHtml),
    skills,
  };
}

/**
 * Deterministically applies the candidate's rules to AI output: locked
 * sections are restored verbatim, the headline gets the required prefix, and
 * job-ad noise such as "(H/F)" is removed from tailored headlines.
 */
export function enforceTailoringRules(
  data: TailoredData,
  rules: TailoringRules,
  originals: TailoredData,
  jobTitle?: string | null,
): TailoredData {
  let headline = originals.headline;
  if (rules.headline.mode !== "keep") {
    const tailored = stripJobTitleGenderMarkers(data.headline);
    const fallback = jobTitle
      ? stripJobTitleGenderMarkers(jobTitle)
      : originals.headline;
    headline = applyDesignResumeHeadlinePrefix(
      tailored || fallback,
      rules.headline.prefix,
    );
  }

  return {
    headline,
    summary: rules.summary.mode === "keep" ? originals.summary : data.summary,
    skills: rules.skills.mode === "keep" ? originals.skills : data.skills,
  };
}

/**
 * Generate tailored resume content (summary, headline, skills) for a job.
 */
export async function generateTailoring(
  jobDescription: string,
  profile: ResumeProfile,
  options: {
    /** User asked to regenerate: skip the LLM response cache. */
    fresh?: boolean;
    /** The posting's title; descriptions often omit it. */
    jobTitle?: string | null;
  } = {},
): Promise<TailoringResult> {
  const rules = resolveTailoringRules(profile);
  const originals = getOriginalTailoringValues(profile);

  // Nothing for the AI to do when every tailorable section is locked.
  if (
    rules.headline.mode === "keep" &&
    rules.summary.mode === "keep" &&
    rules.skills.mode === "keep"
  ) {
    return { success: true, data: originals };
  }

  const [model, writingStyle] = await Promise.all([
    resolveLlmModel("tailoring"),
    getWritingStyle(),
  ]);
  const jobTitle = options.jobTitle?.trim() || null;
  const prompt = await buildTailoringPrompt(
    profile,
    jobTitle ? `Job title: ${jobTitle}\n\n${jobDescription}` : jobDescription,
    writingStyle,
    rules,
  );

  const llm = await createConfiguredLlmService("tailoring");
  const result = await llm.callJson<TailoredData>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: TAILORING_SCHEMA,
    bypassCache: options.fresh === true,
  });

  if (!result.success) {
    const context = `provider=${llm.getProvider()} baseUrl=${llm.getBaseUrl()}`;
    if (result.error.toLowerCase().includes("api key")) {
      const message = `LLM API key not set, cannot generate tailoring. (${context})`;
      logger.warn(message);
      return { success: false, error: message };
    }
    return {
      success: false,
      error: `${result.error} (${context})`,
    };
  }

  const { summary, headline, skills } = result.data;

  // Basic validation
  if (!summary || !headline || !Array.isArray(skills)) {
    logger.warn("AI response missing required tailoring fields", result.data);
  }

  return {
    success: true,
    data: enforceTailoringRules(
      {
        summary: sanitizeText(summary || ""),
        headline: sanitizeText(headline || ""),
        skills: Array.isArray(skills) ? skills : [],
      },
      rules,
      originals,
      jobTitle,
    ),
  };
}

async function buildTailoringPrompt(
  profile: ResumeProfile,
  jd: string,
  writingStyle: Awaited<ReturnType<typeof getWritingStyle>>,
  rules: TailoringRules,
): Promise<string> {
  // Adapt the CV to the job posting's language. Priority:
  //   1. language confidently detected from the job description
  //   2. else the resume's OWN language (a French résumé must stay French
  //      when the JD is ambiguous — never silently fall back to English)
  //   3. else the configured/style default
  const jobDescriptionLanguage = detectLanguageFromText(jd);
  const profileLanguage = detectProfileLanguage(profile);
  const resolvedLanguage = jobDescriptionLanguage
    ? { language: jobDescriptionLanguage, source: "detected" as const }
    : profileLanguage
      ? { language: profileLanguage, source: "detected" as const }
      : resolveWritingOutputLanguage({
          style: writingStyle,
          profile,
        });
  const outputLanguage = getWritingLanguageLabel(resolvedLanguage.language);
  let effectiveConstraints = stripLanguageDirectivesFromConstraints(
    writingStyle.constraints,
  );
  if (writingStyle.summaryMaxWords != null) {
    effectiveConstraints = stripWordLimitFromConstraints(effectiveConstraints);
  }
  if (writingStyle.maxKeywordsPerSkill != null) {
    effectiveConstraints =
      stripKeywordLimitFromConstraints(effectiveConstraints);
  }

  // Only the parts the model needs (saves tokens, avoids unnecessary PII).
  // The AI view drops sections the candidate marked private and attaches
  // their notes as `aiNotes`.
  const view = buildAiProfileView(profile);
  const sections = (view.sections ?? {}) as Record<string, unknown>;
  const itemsOf = (key: string): Array<Record<string, unknown>> => {
    const section = sections[key] as { items?: unknown } | undefined;
    return Array.isArray(section?.items)
      ? (section.items as Array<Record<string, unknown>>).filter(
          (item) => item && item.visible !== false,
        )
      : [];
  };
  const summaryHtml = view.basics?.summary;
  const candidateNotes = formatCandidateNotes(profile);
  const relevantProfile = {
    basics: {
      name: view.basics?.name,
      label: view.basics?.label, // Original headline
      summary: summaryHtml ? htmlToPlainText(summaryHtml) : undefined,
    },
    skills: view.sections?.skills,
    projects: itemsOf("projects").map((p) => ({
      name: p.name,
      description: p.description,
      keywords: p.keywords,
      aiNotes: p.aiNotes,
    })),
    experience: itemsOf("experience").map((e) => ({
      company: e.company,
      position: e.position,
      summary: e.summary,
      aiNotes: e.aiNotes,
    })),
    education: itemsOf("education").map((e) => ({
      school: e.school,
      degree: e.degree,
      area: e.area,
      date: e.date,
      aiNotes: e.aiNotes,
    })),
    languages: itemsOf("languages").map((l) => ({
      language: l.language,
      fluency: l.fluency,
    })),
    ...(candidateNotes ? { candidateNotes } : {}),
  };

  const template = await getEffectivePromptTemplate("tailoringPromptTemplate");

  return renderPromptTemplate(template, {
    jobDescription: jd,
    profileJson: JSON.stringify(relevantProfile, null, 2),
    outputLanguage,
    tone: writingStyle.tone,
    formality: writingStyle.formality,
    summaryMaxWordsLine:
      writingStyle.summaryMaxWords != null
        ? ` Maximum ${writingStyle.summaryMaxWords} ${writingStyle.summaryMaxWords === 1 ? "word" : "words"}.`
        : "",
    maxKeywordsPerSkillLine:
      writingStyle.maxKeywordsPerSkill != null
        ? `\n   - Maximum ${writingStyle.maxKeywordsPerSkill} ${writingStyle.maxKeywordsPerSkill === 1 ? "keyword" : "keywords"} per category. If a category has more, keep only the most JD-relevant ones.`
        : "",
    constraintsBullet: effectiveConstraints
      ? `- Additional constraints: ${effectiveConstraints}`
      : "",
    avoidTermsBullet: writingStyle.doNotUse
      ? `- Avoid these words or phrases: ${writingStyle.doNotUse}`
      : "",
    candidateInstructions: formatTailoringRulesForPrompt(rules),
  });
}

function sanitizeText(text: string): string {
  return text
    .replace(/\*\*[\s\S]*?\*\*/g, "") // remove markdown bold
    .trim();
}
