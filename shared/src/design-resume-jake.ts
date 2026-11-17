type RecordLike = Record<string, unknown>;

export type DesignResumeJakeContactItem = {
  text: string;
  url?: string | null;
  /** Icon name chosen in the editor (custom fields), e.g. "calendar". */
  icon?: string | null;
  /** Custom basics fields (e.g. availability) as opposed to contact links. */
  kind?: "custom";
};

/**
 * Bold runs inside bullets/summary are delimited with these control
 * characters so renderers can restore them (e.g. LaTeX `\textbf{}`); they
 * never appear in user text.
 */
export const JAKE_BOLD_START = "\u0001";
export const JAKE_BOLD_END = "\u0002";

export type DesignResumeJakeEntry = {
  id: string;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  date?: string | null;
  bullets: string[];
  url?: string | null;
};

export type DesignResumeJakeSkillGroup = {
  id: string;
  name: string;
  keywords: string[];
};

export type DesignResumeJakeExtraSectionKind =
  | "certifications"
  | "awards"
  | "publications"
  | "volunteer"
  | "custom";

export type DesignResumeJakeExtraSection = {
  /** Stable kind so the renderer can localize the section title. "custom"
   *  keeps the user-provided `title` as-is. */
  kind: DesignResumeJakeExtraSectionKind;
  title: string;
  entries: DesignResumeJakeEntry[];
};

export type DesignResumeJakeDocument = {
  name: string;
  headline?: string | null;
  contacts: DesignResumeJakeContactItem[];
  summary?: string | null;
  experience: DesignResumeJakeEntry[];
  education: DesignResumeJakeEntry[];
  projects: DesignResumeJakeEntry[];
  skills: DesignResumeJakeSkillGroup[];
  languages: string[];
  interests: string[];
  extraSections: DesignResumeJakeExtraSection[];
};

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function getByPath(source: RecordLike, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    return (current as RecordLike)[segment];
  }, source);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

const INLINE_TAG_PATTERN =
  /<\/?(?:em|i|u|span|a|code|mark|small|sub|sup|s|strike|del|ins|font)\b[^>]*>/gi;

/**
 * HTML → plain text. Inline tags are removed without adding spaces (so
 * "<strong>Paris</strong>," stays "Paris,"); block boundaries become line
 * breaks. With `keepBold`, bold runs are wrapped in JAKE_BOLD_* markers.
 */
function stripHtml(
  value: string,
  options: { keepBold?: boolean } = {},
): string {
  const withBold = options.keepBold
    ? value
        .replace(/<(?:strong|b)\b[^>]*>/gi, JAKE_BOLD_START)
        .replace(/<\/(?:strong|b)>/gi, JAKE_BOLD_END)
    : value.replace(/<\/?(?:strong|b)\b[^>]*>/gi, "");
  return decodeHtml(
    withBold
      .replace(INLINE_TAG_PATTERN, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
      .replace(/<\/li>\s*<li[^>]*>/gi, "\n")
      .replace(/<\/?[^>]+>/g, " "),
  )
    .replace(/\s*\n\s*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function extractBullets(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];

  const listItems = [...value.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => stripHtml(match[1] ?? "", { keepBold: true }))
    .filter(Boolean);
  if (listItems.length > 0) return listItems;

  const cleaned = stripHtml(value, { keepBold: true });
  if (!cleaned) return [];
  return cleaned
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function dedupeContacts(
  contacts: DesignResumeJakeContactItem[],
): DesignResumeJakeContactItem[] {
  const seen = new Set<string>();
  return contacts.filter((item) => {
    const key = `${item.text}|${item.url ?? ""}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getVisibleSectionItems(
  resumeJson: RecordLike,
  sectionKey: string,
): RecordLike[] {
  const sections = (asRecord(resumeJson.sections) ?? {}) as RecordLike;
  const section = (asRecord(sections[sectionKey]) ?? {}) as RecordLike;
  if (toBoolean(section.hidden, false)) return [];

  return asArray(section.items)
    .map((item) => asRecord(item) ?? {})
    .filter((item) => !toBoolean(item.hidden, false)) as RecordLike[];
}

function buildContacts(resumeJson: RecordLike): DesignResumeJakeContactItem[] {
  const basics = (asRecord(resumeJson.basics) ?? {}) as RecordLike;
  const sections = (asRecord(resumeJson.sections) ?? {}) as RecordLike;
  const contacts: DesignResumeJakeContactItem[] = [];

  const phone = toText(basics.phone);
  if (phone) contacts.push({ text: phone });

  const email = toText(basics.email);
  if (email) contacts.push({ text: email, url: `mailto:${email}` });

  const websiteUrl = toText(getByPath(basics, "website.url"));
  const websiteLabel = toText(getByPath(basics, "website.label")) || websiteUrl;
  if (websiteUrl) contacts.push({ text: websiteLabel, url: websiteUrl });

  const profilesSection = (asRecord(sections.profiles) ?? {}) as RecordLike;
  const profileItems = asArray(profilesSection.items).map(
    (item) => asRecord(item) ?? {},
  ) as RecordLike[];
  for (const item of profileItems) {
    if (toBoolean(item.hidden, false)) continue;
    const url = toText(getByPath(item, "website.url"));
    const network = toText(item.network);
    const username = toText(item.username);
    const label = network || username || url;
    if (label) contacts.push({ text: label, url: url || undefined });
  }

  const customFields = asArray(basics.customFields).map(
    (item) => asRecord(item) ?? {},
  ) as RecordLike[];
  for (const field of customFields) {
    const text =
      toText(field.text) || toText(field.name) || toText(field.value);
    const link = toText(field.link);
    const icon = toText(field.icon);
    if (text) {
      contacts.push({
        text,
        url: link || undefined,
        icon: icon || undefined,
        kind: "custom",
      });
    }
  }

  return dedupeContacts(contacts);
}

function toExperienceEntries(resumeJson: RecordLike): DesignResumeJakeEntry[] {
  return getVisibleSectionItems(resumeJson, "experience").map(
    (item, index) => ({
      id: toText(item.id, `experience-${index}`),
      title: toText(item.company, "Untitled"),
      subtitle: toText(item.position) || null,
      meta: toText(item.location) || null,
      date: toText(item.period) || null,
      bullets: extractBullets(item.description),
      url: toText(getByPath(item, "website.url")) || undefined,
    }),
  );
}

function toEducationEntries(resumeJson: RecordLike): DesignResumeJakeEntry[] {
  return getVisibleSectionItems(resumeJson, "education").map((item, index) => ({
    id: toText(item.id, `education-${index}`),
    title: toText(item.school, "Untitled"),
    subtitle:
      [toText(item.degree), toText(item.area)].filter(Boolean).join(", ") ||
      null,
    meta:
      [toText(item.location), toText(item.grade)].filter(Boolean).join(" | ") ||
      null,
    date: toText(item.period) || null,
    bullets: extractBullets(item.description),
    url: toText(getByPath(item, "website.url")) || undefined,
  }));
}

function toProjectEntries(resumeJson: RecordLike): DesignResumeJakeEntry[] {
  return getVisibleSectionItems(resumeJson, "projects").map((item, index) => {
    const technologies = asArray(item.keywords)
      .map((value) => toText(value))
      .filter(Boolean)
      .join(", ");

    return {
      id: toText(item.id, `project-${index}`),
      title: toText(item.name, "Untitled"),
      subtitle: technologies || null,
      date: toText(item.period) || null,
      bullets: extractBullets(item.description),
      url: toText(getByPath(item, "website.url")) || undefined,
    };
  });
}

function toSkillGroups(resumeJson: RecordLike): DesignResumeJakeSkillGroup[] {
  return getVisibleSectionItems(resumeJson, "skills").map((item, index) => ({
    id: toText(item.id, `skill-${index}`),
    name: toText(item.name, "Skills"),
    keywords: asArray(item.keywords)
      .map((entry) => toText(entry))
      .filter(Boolean),
  }));
}

function toLanguages(resumeJson: RecordLike): string[] {
  return getVisibleSectionItems(resumeJson, "languages")
    .map((item) => {
      const name = toText(item.language) || toText(item.name);
      if (!name) return "";
      const fluency = toText(item.fluency);
      return fluency ? `${name} (${fluency})` : name;
    })
    .filter(Boolean);
}

function toInterests(resumeJson: RecordLike): string[] {
  return getVisibleSectionItems(resumeJson, "interests")
    .map((item) => toText(item.name))
    .filter(Boolean);
}

function toGenericEntries(
  resumeJson: RecordLike,
  sectionKey: string,
): DesignResumeJakeEntry[] {
  return getVisibleSectionItems(resumeJson, sectionKey).map((item, index) => ({
    id: toText(item.id, `${sectionKey}-${index}`),
    title:
      toText(item.title) ||
      toText(item.name) ||
      toText(item.organization, "Untitled"),
    subtitle:
      toText(item.issuer) ||
      toText(item.publisher) ||
      toText(item.location) ||
      null,
    date: toText(item.date) || toText(item.period) || null,
    bullets: extractBullets(item.description ?? item.summary),
    url: toText(getByPath(item, "website.url")) || undefined,
  }));
}

function toCustomSections(
  resumeJson: RecordLike,
): DesignResumeJakeExtraSection[] {
  return asArray(resumeJson.customSections)
    .map((value) => asRecord(value) ?? {})
    .filter((section) => !toBoolean(section.hidden, false))
    .map((section, index) => ({
      kind: "custom" as const,
      title: toText(section.name, `Section ${index + 1}`),
      entries: asArray(section.items)
        .map((value) => asRecord(value) ?? {})
        .filter((item) => !toBoolean(item.hidden, false))
        .map((item, i) => ({
          id: toText(item.id, `custom-${index}-${i}`),
          title: toText(item.name) || toText(item.title, "Untitled"),
          subtitle: null,
          date: toText(item.date) || toText(item.period) || null,
          bullets: extractBullets(item.description ?? item.summary),
          url: toText(getByPath(item, "website.url")) || undefined,
        })),
    }))
    .filter((section) => section.entries.length > 0);
}

export function buildDesignResumeJakeDocument(
  resumeJson: Record<string, unknown>,
): DesignResumeJakeDocument {
  const basics = (asRecord(resumeJson.basics) ?? {}) as RecordLike;
  const summary = (asRecord(resumeJson.summary) ?? {}) as RecordLike;

  const extraSections: DesignResumeJakeExtraSection[] = [];
  const sectionLabels: Record<
    Exclude<DesignResumeJakeExtraSectionKind, "custom">,
    string
  > = {
    certifications: "Certifications",
    awards: "Awards",
    publications: "Publications",
    volunteer: "Volunteer",
  };
  for (const kind of [
    "certifications",
    "awards",
    "publications",
    "volunteer",
  ] as const) {
    const entries = toGenericEntries(resumeJson, kind);
    if (entries.length > 0) {
      extraSections.push({ kind, title: sectionLabels[kind], entries });
    }
  }
  extraSections.push(...toCustomSections(resumeJson));

  return {
    name: toText(basics.name, "Your Name"),
    headline: toText(basics.headline) || null,
    contacts: buildContacts(resumeJson),
    summary:
      !toBoolean(summary.hidden, false) && toText(summary.content)
        ? stripHtml(toText(summary.content), { keepBold: true })
        : null,
    experience: toExperienceEntries(resumeJson),
    education: toEducationEntries(resumeJson),
    projects: toProjectEntries(resumeJson),
    skills: toSkillGroups(resumeJson),
    languages: toLanguages(resumeJson),
    interests: toInterests(resumeJson),
    extraSections,
  };
}
