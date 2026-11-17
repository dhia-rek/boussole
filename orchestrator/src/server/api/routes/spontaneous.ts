import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { badRequest, toAppError, upstreamError } from "@server/infra/errors";
import { fail, ok } from "@server/infra/http";
import { getSetting } from "@server/repositories/settings";
import { LlmService } from "@server/services/llm/service";
import type { JsonSchemaDefinition } from "@server/services/llm/types";
import { resolveLlmModel } from "@server/services/modelSelection";
import { getProfile } from "@server/services/profile";
import { Router } from "express";
import { z } from "zod";

export const spontaneousRouter = Router();

const HUNTER_API = "https://api.hunter.io/v2";

interface HunterEmail {
  value: string;
  type: string;
  confidence: number;
  first_name?: string;
  last_name?: string;
  position?: string;
  department?: string;
}

interface HunterDomainResponse {
  data?: {
    domain?: string;
    organization?: string;
    pattern?: string;
    emails?: HunterEmail[];
  };
  errors?: { details: string }[];
}

const EMAIL_SCHEMA: JsonSchemaDefinition = {
  name: "cold_email",
  schema: {
    type: "object",
    properties: {
      subject: { type: "string" },
      body: { type: "string" },
    },
    required: ["subject", "body"],
    additionalProperties: false,
  },
};

// POST /api/spontaneous/lookup
spontaneousRouter.post("/lookup", async (req, res) => {
  const parsed = z
    .object({ domain: z.string().min(1).max(200) })
    .safeParse(req.body);
  if (!parsed.success) {
    fail(res, badRequest("domain is required"));
    return;
  }

  const apiKey = await getSetting("hunterApiKey");
  if (!apiKey) {
    fail(
      res,
      badRequest("Hunter.io API key not configured. Add it in Settings."),
    );
    return;
  }

  const domain = parsed.data.domain
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .trim();

  try {
    const url = `${HUNTER_API}/domain-search?domain=${encodeURIComponent(domain)}&limit=10&type=personal&api_key=${apiKey}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const data = (await resp.json()) as HunterDomainResponse;

    if (!resp.ok || data.errors?.length) {
      fail(
        res,
        upstreamError(
          data.errors?.[0]?.details ?? `Hunter API error ${resp.status}`,
        ),
      );
      return;
    }

    const emails = (data.data?.emails ?? [])
      .filter((e) => e.confidence >= 50)
      .sort((a, b) => {
        const hrScore = (e: HunterEmail) =>
          ["hr", "human", "recruit", "talent", "people", "rh"].some((kw) =>
            `${e.position ?? ""} ${e.department ?? ""}`
              .toLowerCase()
              .includes(kw),
          )
            ? 1
            : 0;
        return hrScore(b) - hrScore(a) || b.confidence - a.confidence;
      })
      .slice(0, 8)
      .map((e) => ({
        email: e.value,
        name: [e.first_name, e.last_name].filter(Boolean).join(" ") || null,
        position: e.position ?? null,
        confidence: e.confidence,
      }));

    ok(res, {
      organization: data.data?.organization ?? domain,
      domain: data.data?.domain ?? domain,
      pattern: data.data?.pattern ?? null,
      emails,
    });
  } catch (err) {
    logger.error("Hunter.io lookup failed", { error: String(err) });
    fail(res, toAppError(err));
  }
});

// POST /api/spontaneous/generate-email
spontaneousRouter.post("/generate-email", async (req, res) => {
  const parsed = z
    .object({
      company: z.string().min(1).max(200),
      recipientName: z.string().max(100).optional(),
      recipientPosition: z.string().max(100).optional(),
      targetRole: z.string().max(200).optional(),
      language: z.enum(["en", "fr"]).default("en"),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    fail(res, badRequest("Invalid request"));
    return;
  }

  const model = await resolveLlmModel();
  const llm = new LlmService();

  let profileSummary = "No resume profile available.";
  try {
    const profile = await getProfile();
    const name = profile?.basics?.name ?? "Unknown";
    const headline = profile?.basics?.headline ?? profile?.basics?.label ?? "";
    const skills = (profile?.sections?.skills?.items ?? [])
      .slice(0, 8)
      .map((s) => s.name)
      .join(", ");
    const experience = (profile?.sections?.experience?.items ?? [])
      .filter((e) => e.visible !== false)
      .slice(0, 3)
      .map((e) => `${e.position} at ${e.company}`)
      .join("; ");
    type EducationItem = {
      degree?: string;
      studyType?: string;
      institution: string;
    };
    type EducationSection = { items?: EducationItem[] };
    const eduSection = profile?.sections?.education as
      | EducationSection
      | undefined;
    const education = (eduSection?.items ?? [])
      .slice(0, 2)
      .map((e) => `${e.degree ?? e.studyType ?? ""} at ${e.institution}`)
      .join("; ");

    profileSummary = [
      `Name: ${name}`,
      headline ? `Headline: ${headline}` : null,
      skills ? `Skills: ${skills}` : null,
      experience ? `Experience: ${experience}` : null,
      education ? `Education: ${education}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    // keep default
  }

  const { company, recipientName, recipientPosition, targetRole, language } =
    parsed.data;

  const langInstruction =
    language === "fr"
      ? "Write the email in French. Use professional French (vous)."
      : "Write the email in English. Use a professional tone.";

  const recipient = recipientName
    ? `${recipientName}${recipientPosition ? `, ${recipientPosition}` : ""}`
    : "HR/Recruitment team";

  const prompt = `You are helping write a spontaneous job application email.

${langInstruction}

Candidate profile:
${profileSummary}

Target company: ${company}
Recipient: ${recipient}
${targetRole ? `Target role: ${targetRole}` : "Target: any relevant position matching the candidate's profile"}

Write a concise, personalized spontaneous application email. Return JSON with:
- "subject": the email subject line
- "body": the full email body (greeting through sign-off)

Guidelines:
- Under 250 words total
- Specific to the company (not generic)
- Highlight 2-3 most relevant skills/experience
- End with a clear call to action
- Be genuine and direct`;

  const result = await llm.callJson<{ subject: string; body: string }>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: EMAIL_SCHEMA,
  });

  if (!result.success) {
    // The CLI's own output can contain stderr; keep it in the logs only.
    logger.warn("Spontaneous email generation failed", {
      error: sanitizeUnknown(result.error),
    });
    fail(
      res,
      upstreamError(
        "Claude could not write the email. Check that Claude is signed in on this computer, then try again.",
      ),
    );
    return;
  }

  ok(res, result.data);
});
