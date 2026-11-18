/**
 * Writing the spontaneous application email from two sources only: the CV
 * variant in the email's language (as the CV check's numbered dictionary,
 * private sections left out) and the company facts Boussole verified.
 */
import { badRequest, unprocessableEntity, upstreamError } from "@infra/errors";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import type {
  DesignResumeDocument,
  OutreachEmail,
  SpontaneousOutreach,
} from "@shared/types";
import { buildCvDictionary } from "../cv-check/dictionary";
import { findNewTerms } from "../cv-check/review";
import { getCurrentDesignResume } from "../design-resume";
import { LlmService } from "../llm/service";
import type { JsonSchemaDefinition } from "../llm/types";
import { resolveLlmModel } from "../modelSelection";

const EMAIL_SCHEMA: JsonSchemaDefinition = {
  name: "spontaneous_email",
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

export type EmailRequest = {
  recipient: string | null;
  recipientName: string | null;
  targetRole: string | null;
  language: "fr" | "en";
};

type EmailLlm = Pick<LlmService, "callJson">;

/** The CV in the email's language, else the primary CV. */
async function cvForLanguage(
  language: "fr" | "en",
): Promise<DesignResumeDocument | null> {
  try {
    const variant = await getCurrentDesignResume({ language });
    if (variant) return variant;
  } catch {
    // Unknown variant: fall back to the primary CV.
  }
  return getCurrentDesignResume();
}

export function buildEmailPrompt(input: {
  outreach: SpontaneousOutreach;
  request: EmailRequest;
  candidateName: string;
  cvLines: string[];
}): string {
  const { outreach, request } = input;
  const facts = outreach.facts.filter((fact) => fact.check === "verified");
  const greeting = request.recipientName
    ? `the email is addressed to ${request.recipientName}`
    : "no named recipient: use a neutral greeting";
  const french = request.language === "fr";
  return `
Write a spontaneous application email (${french ? "candidature spontanée, in French, vouvoiement" : "in English"}).

Company: ${outreach.company}
${outreach.summary ? `About the company: ${outreach.summary}\n` : ""}Verified facts about the company (the ONLY company facts you may mention):
${facts.map((fact) => `- ${fact.claim}`).join("\n") || "- (none: do not state any fact about the company)"}

Recipient: ${greeting}.
${request.targetRole ? `Target role: ${request.targetRole}` : "No precise role: propose the candidate's profile for roles that match it."}

Candidate: ${input.candidateName}
Candidate CV (the ONLY facts you may state about the candidate):
${input.cvLines.map((line) => `- ${line}`).join("\n")}

Rules:
- Under 200 words. Short paragraphs. Direct and specific, no flattery.
- Connect one or two verified company facts to one or two real CV items.
- Never invent a number, tool, employer, result or company fact.
- Say the CV is attached (${french ? "« Vous trouverez mon CV en pièce jointe »" : '"I have attached my CV"'}).
- End with one clear call to action, then sign with the candidate's name.
- "subject" is short and says it is a spontaneous application${request.targetRole ? " for the target role" : ""}.
`.trim();
}

export async function writeOutreachEmail(
  outreach: SpontaneousOutreach,
  request: EmailRequest,
  options: { llm?: EmailLlm } = {},
): Promise<OutreachEmail> {
  if (outreach.status !== "ready") {
    throw badRequest("Find the contacts first, then write the email.");
  }
  const cv = await cvForLanguage(request.language);
  if (!cv) {
    throw unprocessableEntity(
      "Import or create your CV first (Design Resume), then write the email.",
    );
  }
  const lines = buildCvDictionary(cv.resumeJson, cv.aiGuidance).map(
    (line) => `${line.entry ? `${line.entry}: ` : ""}${line.text}`,
  );
  const basics = (cv.resumeJson as unknown as { basics?: { name?: string } })
    .basics;
  const candidateName = basics?.name?.trim() || "";

  const llm = options.llm ?? new LlmService();
  const result = await llm.callJson<{ subject: string; body: string }>({
    model: await resolveLlmModel(),
    messages: [
      {
        role: "user",
        content: buildEmailPrompt({
          outreach,
          request,
          candidateName,
          cvLines: lines,
        }),
      },
    ],
    jsonSchema: EMAIL_SCHEMA,
    maxRetries: 1,
    bypassCache: true,
  });
  if (!result.success) {
    logger.warn("Spontaneous email generation failed", {
      error: sanitizeUnknown(result.error),
    });
    throw upstreamError(
      "Your AI account could not write the email. Check Settings → AI account, then try again.",
    );
  }
  const subject = String(result.data.subject ?? "")
    .trim()
    .slice(0, 200);
  const body = String(result.data.body ?? "")
    .trim()
    .slice(0, 5000);
  if (!subject || !body) {
    throw upstreamError("Your AI account returned an empty email. Try again.");
  }
  const known = [
    // Ordinary letter vocabulary, never a claim.
    "CV LinkedIn Madame Monsieur Mme Bonjour Cordialement Dear Hello",
    candidateName,
    outreach.company,
    outreach.summary ?? "",
    request.targetRole ?? "",
    request.recipientName ?? "",
    ...lines,
    ...outreach.facts
      .filter((fact) => fact.check === "verified")
      .map((fact) => `${fact.claim} ${fact.quote}`),
  ].join("\n");
  return {
    recipient: request.recipient,
    recipientName: request.recipientName,
    targetRole: request.targetRole,
    language: request.language,
    subject,
    body,
    unsupportedTerms: findNewTerms(`${subject}\n${body}`, known),
  };
}
