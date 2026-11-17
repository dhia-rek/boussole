import type { ChatStyleManualLanguage } from "@shared/types";
import {
  contactIcon,
  escapeForCommand,
  escapeLatexUrl,
  renderRichText,
  stripBoldMarkers,
} from "./latex-text";
import type {
  LatexResumeContactItem,
  LatexResumeDocument,
  LatexResumeEntry,
} from "./types";

/**
 * The Boussole CV layout: Source Sans, a round header photo, languages beside
 * the title, aligned skills right after the profile, a "Stack:" line under
 * each entry and one closing line-per-topic section (certifications,
 * volunteering, interests). Colours live in templates/resume.tex.
 */

interface ResumeLabels {
  babel: string;
  summary: string;
  skills: string;
  experience: string;
  education: string;
  projects: string;
  certifications: string;
  volunteer: string;
  interests: string;
  languages: string;
  /** ":" or " :" (French typography). */
  colon: string;
  /** "Bilingual", "Trilingual"…; null when one language. */
  multilingual: (count: number) => string | null;
  /** Joins the last two names of the closing section's title. */
  and: string;
  /** Heading when three or more short sections are combined. */
  additional: string;
  /** Row label for skills listed without a group. */
  otherSkills: string;
}

function countLabel(
  count: number,
  two: string,
  three: string,
  many: string,
): string | null {
  if (count === 2) return two;
  if (count === 3) return three;
  return count > 3 ? many : null;
}

export const RESUME_LABELS: Record<ChatStyleManualLanguage, ResumeLabels> = {
  english: {
    babel: "english",
    summary: "Profile",
    skills: "Technical Skills",
    experience: "Experience",
    education: "Education",
    projects: "Projects",
    certifications: "Certifications",
    volunteer: "Volunteering",
    interests: "Interests",
    languages: "Languages",
    colon: ":",
    multilingual: (n) =>
      countLabel(n, "Bilingual", "Trilingual", "Multilingual"),
    and: "&",
    additional: "Additional information",
    otherSkills: "Other",
  },
  french: {
    babel: "french",
    summary: "Profil",
    skills: "Compétences techniques",
    experience: "Expériences",
    education: "Formation",
    projects: "Projets",
    certifications: "Certifications",
    volunteer: "Bénévolat",
    interests: "Loisirs",
    languages: "Langues",
    colon: " :",
    multilingual: (n) => countLabel(n, "Bilingue", "Trilingue", "Multilingue"),
    and: "&",
    additional: "Informations complémentaires",
    otherSkills: "Autres",
  },
  german: {
    babel: "ngerman",
    summary: "Profil",
    skills: "Fachliche Kenntnisse",
    experience: "Berufserfahrung",
    education: "Ausbildung",
    projects: "Projekte",
    certifications: "Zertifikate",
    volunteer: "Ehrenamt",
    interests: "Interessen",
    languages: "Sprachen",
    colon: ":",
    multilingual: (n) =>
      countLabel(n, "Zweisprachig", "Dreisprachig", "Mehrsprachig"),
    and: "&",
    additional: "Weitere Angaben",
    otherSkills: "Weitere",
  },
  spanish: {
    babel: "spanish",
    summary: "Perfil",
    skills: "Competencias técnicas",
    experience: "Experiencia",
    education: "Formación",
    projects: "Proyectos",
    certifications: "Certificaciones",
    volunteer: "Voluntariado",
    interests: "Intereses",
    languages: "Idiomas",
    colon: ":",
    multilingual: (n) => countLabel(n, "Bilingüe", "Trilingüe", "Multilingüe"),
    and: "y",
    additional: "Información adicional",
    otherSkills: "Otras",
  },
};

/** "Stack: Python, Docker" bullets become the coloured line under an entry. */
const STACK_BULLET = /^\s*(stack|tech stack|technologies|technos?)\s*:\s*/i;

export function splitStackBullet(bullets: string[]): {
  bullets: string[];
  stack: { label: string; value: string } | null;
} {
  const index = bullets.findIndex((bullet) =>
    STACK_BULLET.test(stripBoldMarkers(bullet)),
  );
  if (index === -1) return { bullets, stack: null };
  const plain = stripBoldMarkers(bullets[index] ?? "").trim();
  const match = STACK_BULLET.exec(plain);
  const label = (match?.[0] ?? "Stack:").trim().replace(/\s+/g, " ");
  return {
    bullets: bullets.filter((_, position) => position !== index),
    stack: { label, value: plain.slice(match?.[0].length ?? 0).trim() },
  };
}

function plainLink(text: string, url?: string | null): string {
  const label = escapeForCommand(text);
  return url ? `\\href{${escapeLatexUrl(url)}}{${label}}` : label;
}

function detailRank(icon: string): number {
  if (icon === "\\faEnvelope") return 0;
  if (icon === "\\faPhone") return 1;
  return 2;
}

/** Email/phone/address on one line, profiles and website on the next. */
export function splitHeaderContacts(
  items: LatexResumeContactItem[],
  location?: string | null,
): {
  tagline: LatexResumeContactItem[];
  details: string[];
  links: string[];
} {
  const tagline = items.filter((item) => item.kind === "custom" && !item.url);
  const rest = items.filter((item) => !tagline.includes(item));
  if (location) rest.push({ text: location, icon: "map-pin" });
  const isLink = (item: LatexResumeContactItem) =>
    Boolean(item.url) && !/^(mailto|tel):/i.test(item.url ?? "");

  const details = rest
    .filter((item) => !isLink(item))
    .map((item) => {
      const inferred = contactIcon(item);
      // Plain text that is neither an email nor a phone is the address.
      const icon =
        item.icon || inferred === "\\faEnvelope" || inferred === "\\faPhone"
          ? inferred
          : "\\faMapMarker";
      return { icon, item };
    })
    .sort((a, b) => detailRank(a.icon) - detailRank(b.icon))
    .map(
      ({ icon, item }) =>
        `\\cvicon{${icon}}\\ ${plainLink(item.text, item.url)}`,
    );

  const links = rest
    .filter(isLink)
    .map((item) => ({ icon: contactIcon(item), item }))
    .sort(
      (a, b) => Number(a.icon === "\\faGlobe") - Number(b.icon === "\\faGlobe"),
    )
    .map(
      ({ icon, item }) =>
        `\\cvicon{${icon}}\\ ${plainLink(item.text, item.url)}`,
    );

  return { tagline, details, links };
}

function renderHeader(
  document: LatexResumeDocument,
  labels: ResumeLabels,
  photoFileName: string | null,
): string {
  const languages = (document.languages ?? []).map((language) =>
    escapeForCommand(language),
  );
  const languageLabel =
    labels.multilingual(languages.length) ??
    (languages.length > 0 ? labels.languages : null);
  const headline = document.headline ? escapeForCommand(document.headline) : "";
  const languageText = languages.join(", ");

  let lead = "";
  if (headline && languageLabel) {
    lead = `\\textbf{${headline} --- ${languageLabel}${labels.colon}} ${languageText}`;
  } else if (headline) {
    lead = `\\textbf{${headline}}`;
  } else if (languageLabel) {
    lead = `\\textbf{${languageLabel}${labels.colon}} ${languageText}`;
  }

  const { tagline, details, links } = splitHeaderContacts(
    document.contactItems,
    document.location,
  );
  const lines: Array<{ text: string; gapAfter: string }> = [];
  if (lead) lines.push({ text: lead, gapAfter: "2pt" });
  for (const item of tagline) {
    lines.push({ text: escapeForCommand(item.text), gapAfter: "3pt" });
  }
  if (details.length > 0) {
    lines.push({ text: details.join(" \\quad "), gapAfter: "3pt" });
  }
  if (links.length > 0) {
    lines.push({ text: links.join(" \\quad "), gapAfter: "3pt" });
  }
  const body = lines
    .map((line, index) =>
      index < lines.length - 1
        ? `  ${line.text} \\\\ \\vspace{${line.gapAfter}}`
        : `  ${line.text}`,
    )
    .join("\n");

  const textWidth = photoFileName ? "0.76" : "1";
  const out = [
    `\\begin{minipage}[t]{${textWidth}\\textwidth}`,
    "  \\raggedright",
    "  \\vspace{0pt}",
    `  {\\Huge \\textbf{\\textcolor{namecolor}{${escapeForCommand(document.name)}}}} \\\\ \\vspace{5pt}`,
    body ? `  {\\small\n${body}}` : "",
    "\\end{minipage}%",
  ];
  if (photoFileName) {
    out.push(
      "\\hfill",
      "\\begin{minipage}[t]{0.21\\textwidth}",
      "  \\raggedleft",
      "  \\vspace{0pt}",
      `  \\cvphoto{${photoFileName}}`,
      "\\end{minipage}",
    );
  }
  out.push("\\vspace{-2pt}");
  return out.filter(Boolean).join("\n");
}

function renderBulletsWithStack(bullets: string[]): string[] {
  const { bullets: items, stack } = splitStackBullet(bullets);
  const lines: string[] = [];
  if (items.length > 0) {
    lines.push("    \\resumeItemListStart");
    for (const item of items) {
      lines.push(`      \\resumeItem{${renderRichText(item)}}`);
    }
    lines.push("    \\resumeItemListEnd");
  }
  if (stack) {
    lines.push(
      `    \\stack{${escapeForCommand(stack.label)}}{${escapeForCommand(stack.value)}}`,
    );
  }
  return lines;
}

function renderSubheadingEntries(entries: LatexResumeEntry[], gap: boolean) {
  return entries
    .map((entry, index) => {
      const role = entry.role ?? entry.subtitle ?? "";
      const lines = [
        "  \\resumeSubheading",
        `    {${escapeForCommand(entry.title)}}{${entry.date ? escapeForCommand(entry.date) : ""}}`,
        `    {${escapeForCommand(role)}}{${entry.meta ? escapeForCommand(entry.meta) : ""}}`,
        ...renderBulletsWithStack(entry.bullets),
      ];
      if (gap && index < entries.length - 1) lines.push("  \\vspace{2pt}");
      return lines.join("\n");
    })
    .join("\n\n");
}

function renderProjectEntries(entries: LatexResumeEntry[]) {
  return entries
    .map((entry) => {
      const subtitle = entry.subtitle
        ? ` $|$ \\emph{${escapeForCommand(entry.subtitle)}}`
        : "";
      return [
        "  \\resumeProjectHeading",
        `    {\\textbf{${escapeForCommand(entry.title)}}${subtitle}}{${entry.date ? escapeForCommand(entry.date) : ""}}`,
        ...renderBulletsWithStack(entry.bullets),
      ].join("\n");
    })
    .join("\n\n");
}

function section(title: string, body: string): string {
  return `\\section{${escapeForCommand(title)}}\n${body}`;
}

function listSection(title: string, body: string): string {
  return section(
    title,
    ["\\resumeSubHeadingListStart", body, "\\resumeSubHeadingListEnd", ""].join(
      "\n",
    ),
  );
}

function formatExtraEntry(entry: LatexResumeEntry): string {
  const meta = [entry.subtitle, entry.date]
    .map((value) => (value ? value.trim() : ""))
    .filter(Boolean)
    .join(", ");
  const base = escapeForCommand(entry.title);
  return meta ? `${base} (${escapeForCommand(meta)})` : base;
}

function renderClosingSection(
  document: LatexResumeDocument,
  labels: ResumeLabels,
): string {
  const rows: Array<{ label: string; value: string }> = [];
  const sections = (document.extraSections ?? []).filter(
    (extra) => extra.entries.length > 0,
  );
  const ordered = [
    ...sections.filter((extra) => extra.kind === "certifications"),
    ...sections.filter((extra) => extra.kind === "volunteer"),
    ...sections.filter(
      (extra) => extra.kind !== "certifications" && extra.kind !== "volunteer",
    ),
  ];
  for (const extra of ordered) {
    const label =
      extra.kind === "certifications"
        ? labels.certifications
        : extra.kind === "volunteer"
          ? labels.volunteer
          : extra.title;
    const separator = extra.kind === "certifications" ? " $|$ " : ", ";
    rows.push({
      label,
      value: extra.entries.map(formatExtraEntry).join(separator),
    });
  }
  const interests = document.interests ?? [];
  if (interests.length > 0) {
    rows.push({
      label: labels.interests,
      value: interests.map((interest) => escapeForCommand(interest)).join(", "),
    });
  }
  if (rows.length === 0) return "";

  const names = rows.map((row) => row.label);
  // Up to three short sections read well as a combined title
  // ("Certifications, Volunteering & Interests"); beyond that a plain
  // heading, with every line still labelled.
  const title =
    names.length === 1
      ? (names[0] ?? "")
      : names.length <= 3
        ? `${names.slice(0, -1).join(", ")} ${labels.and} ${names.at(-1)}`
        : labels.additional;
  const body = rows
    .map((row, index) => {
      const end = index < rows.length - 1 ? "\\par\\vspace{2pt}" : "\\par";
      return `\\hspace*{0.15in}\\textbf{${escapeForCommand(row.label)}}${labels.colon} ${row.value}${end}`;
    })
    .join("\n");
  return section(
    title,
    ["\\vspace{1pt}", "{\\small", body, "}", ""].join("\n"),
  );
}

export function buildResumeLatex(
  document: LatexResumeDocument,
  template: string,
  options: { fitSnippet?: string; photoFileName?: string | null } = {},
): string {
  const labels = RESUME_LABELS[document.language ?? "english"];
  const parts: string[] = [];

  if (document.summary) {
    parts.push(
      section(
        labels.summary,
        [
          "\\vspace{1pt}",
          `\\small{${renderRichText(document.summary)}}`,
          "\\vspace{2pt}",
          "",
        ].join("\n"),
      ),
    );
  }
  const groupedSkills = document.skillGroups.filter(
    (group) => group.keywords.length > 0,
  );
  const looseSkills = document.skillGroups
    .filter((group) => group.keywords.length === 0)
    .map((group) => group.name.trim())
    .filter(Boolean);
  if (groupedSkills.length === 0 && looseSkills.length > 0) {
    // A flat list (no groups): one wrapped line, not one skill per row.
    parts.push(
      section(
        labels.skills,
        [
          "\\vspace{1pt}",
          `{\\small\\leftskip=0.15in ${looseSkills.map((skill) => escapeForCommand(skill)).join(" $\\cdot$ ")}\\par}`,
          "",
        ].join("\n"),
      ),
    );
  } else if (groupedSkills.length > 0) {
    // Labels in one column, technologies in the other: faster to scan.
    const groupRows = groupedSkills.map(
      (group) =>
        `${escapeForCommand(group.name)} & ${group.keywords.map((keyword) => escapeForCommand(keyword)).join(", ")} \\\\[2pt]`,
    );
    if (looseSkills.length > 0) {
      groupRows.push(
        `${escapeForCommand(labels.otherSkills)} & ${looseSkills.map((skill) => escapeForCommand(skill)).join(", ")} \\\\[2pt]`,
      );
    }
    const rows = groupRows.join("\n");
    parts.push(
      section(
        labels.skills,
        [
          "\\vspace{2pt}",
          "{\\small",
          "\\begin{tabularx}{\\linewidth}{@{\\hspace{0.15in}}>{\\bfseries}l@{\\hspace{10pt}}X@{}}",
          rows,
          "\\end{tabularx}",
          "}",
          "",
        ].join("\n"),
      ),
    );
  }
  if (document.experience.length > 0) {
    parts.push(
      listSection(
        labels.experience,
        renderSubheadingEntries(document.experience, false),
      ),
    );
  }
  if (document.education.length > 0) {
    parts.push(
      listSection(
        labels.education,
        renderSubheadingEntries(document.education, true),
      ),
    );
  }
  if (document.projects.length > 0) {
    parts.push(
      listSection(labels.projects, renderProjectEntries(document.projects)),
    );
  }
  const closing = renderClosingSection(document, labels);
  if (closing) parts.push(closing);

  return template
    .replace("__BABEL__", labels.babel)
    .replace("__FIT__", options.fitSnippet ?? "")
    .replace(
      "__HEADER__",
      renderHeader(document, labels, options.photoFileName ?? null),
    )
    .replace("__BODY__", parts.join("\n"));
}
