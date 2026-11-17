/**
 * Curated list of companies to pull jobs from directly via their ATS.
 *
 * `ats` is the platform; `slug` is that company's board identifier:
 *   - greenhouse:      https://boards-api.greenhouse.io/v1/boards/<slug>/jobs
 *   - lever:           https://api.lever.co/v0/postings/<slug>
 *   - ashby:           https://api.ashbyhq.com/posting-api/job-board/<slug>
 *   - workable:        https://apply.workable.com/api/v1/widget/accounts/<slug>
 *   - smartrecruiters: https://api.smartrecruiters.com/v1/companies/<slug>/postings
 *   - teamtailor:      https://<slug>.teamtailor.com/jobs.rss, or
 *                      https://<host>/jobs.rss when the board lives on a custom domain
 *
 * Focus: AI / data employers that hire in France (startups, scale-ups and
 * consulting firms that recruit juniors on CDI), plus a few international AI
 * companies whose France / remote-EU roles are kept. Every board was verified
 * on 2026-11-17. A board that stops answering (e.g. 404 after an ATS move) is
 * skipped and reported in progress, so a stale entry never fails the run.
 */

export type AtsPlatform =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "smartrecruiters"
  | "teamtailor";

export interface AtsCompany {
  /** Display name used as the job's employer. */
  name: string;
  ats: AtsPlatform;
  slug: string;
  /** Teamtailor only: custom careers domain serving `/jobs.rss`. */
  host?: string;
}

export const ATS_COMPANIES: AtsCompany[] = [
  // --- AI labs / model companies ---
  // Mistral AI moved from Lever to Ashby; Hugging Face recruits on Workable.
  { name: "Mistral AI", ats: "ashby", slug: "mistral.ai" },
  { name: "Hugging Face", ats: "workable", slug: "huggingface" },
  { name: "H Company", ats: "ashby", slug: "hcompany" },
  { name: "Helsing", ats: "greenhouse", slug: "helsing" },
  { name: "Anthropic", ats: "greenhouse", slug: "anthropic" },
  { name: "ElevenLabs", ats: "ashby", slug: "elevenlabs" },
  { name: "Cohere", ats: "ashby", slug: "cohere" },
  { name: "Scale AI", ats: "greenhouse", slug: "scaleai" },
  { name: "Together AI", ats: "greenhouse", slug: "togetherai" },

  // --- French AI product companies and AI-native startups ---
  { name: "Dust", ats: "ashby", slug: "dust" },
  { name: "Photoroom", ats: "ashby", slug: "photoroom" },
  { name: "Owkin", ats: "ashby", slug: "owkin" },
  { name: "Bioptimus", ats: "greenhouse", slug: "bioptimus8" },
  { name: "Nabla", ats: "ashby", slug: "nabla" },
  { name: "Lifen", ats: "ashby", slug: "lifen" },
  { name: "Doctrine", ats: "lever", slug: "doctrine" },
  { name: "Shift Technology", ats: "greenhouse", slug: "shifttechnology" },
  { name: "Modjo", ats: "teamtailor", slug: "modjo" },
  { name: "GetVocal AI", ats: "workable", slug: "getvocal-ai" },
  { name: "Giskard", ats: "workable", slug: "giskard" },
  {
    name: "Kili Technology",
    ats: "teamtailor",
    slug: "kili-technology",
    host: "careers.kili-technology.com",
  },
  { name: "Quandela", ats: "workable", slug: "quandela" },
  { name: "Pasqal", ats: "teamtailor", slug: "pasqal" },
  { name: "Alice & Bob", ats: "lever", slug: "alice-bob" },

  // --- Data / AI consulting (junior CDI hiring, proof-of-concept work) ---
  { name: "Devoteam", ats: "smartrecruiters", slug: "Devoteam" },
  { name: "Artefact", ats: "greenhouse", slug: "artefact" },
  { name: "Ekimetrics", ats: "lever", slug: "ekimetrics" },
  { name: "Fifty-Five", ats: "workable", slug: "fifty-five" },
  { name: "La Javaness", ats: "workable", slug: "la-javaness" },

  // --- Data / ML infrastructure ---
  { name: "Databricks", ats: "greenhouse", slug: "databricks" },
  { name: "Datadog", ats: "greenhouse", slug: "datadog" },
  { name: "Dataiku", ats: "greenhouse", slug: "dataiku" },
  { name: "Scaleway", ats: "lever", slug: "scaleway" },
  { name: "Algolia", ats: "greenhouse", slug: "algolia" },

  // --- Scale-ups with data / AI teams in France ---
  { name: "Pennylane", ats: "ashby", slug: "pennylane" },
  { name: "Pigment", ats: "lever", slug: "pigment" },
  { name: "Qonto", ats: "ashby", slug: "qonto" },
  { name: "Alan", ats: "ashby", slug: "alan" },
  { name: "Doctolib", ats: "ashby", slug: "doctolib" },
  { name: "Back Market", ats: "ashby", slug: "backmarket" },
  { name: "Mirakl", ats: "greenhouse", slug: "mirakl" },
  { name: "Contentsquare", ats: "lever", slug: "contentsquare" },
  { name: "Ledger", ats: "ashby", slug: "ledger" },
  // Spendesk and ManoMano only answer on their custom domains.
  {
    name: "Spendesk",
    ats: "teamtailor",
    slug: "spendesk",
    host: "career.spendesk.com",
  },
  { name: "PayFit", ats: "teamtailor", slug: "payfit" },
  { name: "Swile", ats: "lever", slug: "swile" },
  { name: "Agicap", ats: "lever", slug: "agicap" },
  { name: "Brevo", ats: "lever", slug: "brevo" },
  { name: "Aircall", ats: "greenhouse", slug: "aircallioinc" },
  { name: "Withings", ats: "workable", slug: "withings" },
  { name: "Ubisoft", ats: "smartrecruiters", slug: "Ubisoft2" },
  { name: "Deezer", ats: "teamtailor", slug: "deezer" },
  {
    name: "ManoMano",
    ats: "teamtailor",
    slug: "manomano",
    host: "careers.manomano.jobs",
  },
  { name: "Vestiaire Collective", ats: "lever", slug: "vestiairecollective" },
  { name: "Malt", ats: "lever", slug: "malt" },
  { name: "BlaBlaCar", ats: "lever", slug: "blablacar" },
  { name: "Sorare", ats: "ashby", slug: "sorare" },
  { name: "Ankorstore", ats: "ashby", slug: "ankorstore" },

  // --- International product companies (France / remote-EU roles kept) ---
  { name: "Stripe", ats: "greenhouse", slug: "stripe" },
  { name: "Figma", ats: "greenhouse", slug: "figma" },
  { name: "Notion", ats: "ashby", slug: "notion" },
  { name: "Ramp", ats: "ashby", slug: "ramp" },
];
