import { normalizeResumeJsonToLatexDocument } from "./document";
import { renderLatexPdf } from "./latex";
import type { NormalizeResumeJsonToLatexDocumentOptions } from "./types";

export { normalizeResumeJsonToLatexDocument } from "./document";
export {
  getLatexTemplatePath,
  getTectonicBinary,
  readLatexTemplate,
} from "./latex";
export type * from "./types";

export async function renderResumePdf(args: {
  resumeJson: Record<string, unknown>;
  outputPath: string;
  jobId: string;
  language?: NormalizeResumeJsonToLatexDocumentOptions["language"];
  /** Local image for the round header photo; omitted → no photo. */
  photoPath?: string | null;
}): Promise<void> {
  const document = normalizeResumeJsonToLatexDocument(args.resumeJson, {
    language: args.language,
  });
  await renderLatexPdf({
    document: { ...document, photoPath: args.photoPath ?? null },
    outputPath: args.outputPath,
    jobId: args.jobId,
  });
}
