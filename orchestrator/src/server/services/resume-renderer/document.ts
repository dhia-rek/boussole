import { buildDesignResumeJakeDocument } from "@shared/design-resume-jake";
import type { ChatStyleManualLanguage } from "@shared/types";
import type {
  LatexResumeDocument,
  LatexResumeSectionTitles,
  NormalizeResumeJsonToLatexDocumentOptions,
} from "./types";

const LATEX_RESUME_SECTION_TITLES: Record<
  ChatStyleManualLanguage,
  LatexResumeSectionTitles
> = {
  english: {
    summary: "Summary",
    experience: "Experience",
    education: "Education",
    projects: "Projects",
    skills: "Technical Skills",
    certifications: "Certifications",
    awards: "Awards",
    publications: "Publications",
    volunteer: "Volunteer",
    languages: "Languages",
    interests: "Interests",
    other: "Other",
  },
  german: {
    summary: "Zusammenfassung",
    experience: "Berufserfahrung",
    education: "Ausbildung",
    projects: "Projekte",
    skills: "Fachliche Kenntnisse",
    certifications: "Zertifizierungen",
    awards: "Auszeichnungen",
    publications: "Veröffentlichungen",
    volunteer: "Ehrenamt",
    languages: "Sprachen",
    interests: "Interessen",
    other: "Sonstiges",
  },
  french: {
    summary: "Profil",
    experience: "Expérience",
    education: "Formation",
    projects: "Projets",
    skills: "Compétences techniques",
    certifications: "Certifications",
    awards: "Distinctions",
    publications: "Publications",
    volunteer: "Bénévolat",
    languages: "Langues",
    interests: "Centres d'intérêt",
    other: "Autres",
  },
  spanish: {
    summary: "Resumen",
    experience: "Experiencia",
    education: "Educación",
    projects: "Proyectos",
    skills: "Habilidades técnicas",
    certifications: "Certificaciones",
    awards: "Premios",
    publications: "Publicaciones",
    volunteer: "Voluntariado",
    languages: "Idiomas",
    interests: "Intereses",
    other: "Otros",
  },
};

export function getLatexResumeSectionTitles(
  language: ChatStyleManualLanguage = "english",
): LatexResumeSectionTitles {
  return LATEX_RESUME_SECTION_TITLES[language];
}

export function normalizeResumeJsonToLatexDocument(
  resumeJson: Record<string, unknown>,
  options: NormalizeResumeJsonToLatexDocumentOptions = {},
): LatexResumeDocument {
  const document = buildDesignResumeJakeDocument(resumeJson);
  const sectionTitles = getLatexResumeSectionTitles(options.language);
  const extraSectionTitle = (kind: string, fallback: string): string => {
    if (kind === "certifications") return sectionTitles.certifications;
    if (kind === "awards") return sectionTitles.awards;
    if (kind === "publications") return sectionTitles.publications;
    if (kind === "volunteer") return sectionTitles.volunteer;
    return fallback;
  };

  return {
    name: document.name,
    headline: document.headline,
    contactItems: document.contacts,
    summary: document.summary,
    experience: document.experience.map((entry) => ({
      title: entry.title,
      subtitle:
        [entry.subtitle, entry.meta].filter(Boolean).join(" / ") || null,
      date: entry.date,
      bullets: entry.bullets,
      url: entry.url,
    })),
    education: document.education.map((entry) => ({
      title: entry.title,
      subtitle:
        [entry.subtitle, entry.meta].filter(Boolean).join(" / ") || null,
      date: entry.date,
      bullets: entry.bullets,
      url: entry.url,
    })),
    projects: document.projects.map((entry) => ({
      title: entry.title,
      subtitle: entry.subtitle,
      date: entry.date,
      bullets: entry.bullets,
      url: entry.url,
    })),
    skillGroups: document.skills.map((group) => ({
      name: group.name,
      keywords: group.keywords,
    })),
    languages: document.languages,
    interests: document.interests,
    extraSections: document.extraSections.map((section) => ({
      title: extraSectionTitle(section.kind, section.title),
      kind: section.kind,
      entries: section.entries.map((entry) => ({
        title: entry.title,
        subtitle: entry.subtitle,
        date: entry.date,
        bullets: entry.bullets,
        url: entry.url,
      })),
    })),
    sectionTitles,
  };
}
