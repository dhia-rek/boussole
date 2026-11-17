export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function stripHtmlTags(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]*>/g, " "));
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity[0] === "#") {
        const codePoint =
          entity[1]?.toLowerCase() === "x"
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(codePoint) && codePoint > 0
          ? String.fromCodePoint(codePoint)
          : match;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

/**
 * Converts rich-text HTML (as produced by the resume editor) into readable
 * plain text: block boundaries become line breaks, list items become "- "
 * bullets, tags are dropped and entities decoded.
 */
export function htmlToPlainText(value: string): string {
  if (!value) return "";
  const withBreaks = value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/\s*(p|div|li|ul|ol|h[1-6])\s*>/gi, "\n");
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]*>/g, ""));
  return (
    text
      .split("\n")
      .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
      .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      // Consecutive list items should not be separated by blank lines.
      .replace(/\n\n(?=- )/g, "\n")
      .trim()
  );
}
