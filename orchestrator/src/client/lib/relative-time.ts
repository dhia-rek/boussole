const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

const relativeFormatter = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
});

/** "3 hours ago", "yesterday", "in 2 days"; empty string for missing/invalid input. */
export function formatRelativeTime(
  value: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!value) return "";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const seconds = Math.round((time - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return seconds <= 0 ? "just now" : "in a moment";
  for (const [unit, size] of UNITS) {
    if (abs >= size)
      return relativeFormatter.format(Math.round(seconds / size), unit);
  }
  return relativeFormatter.format(Math.sign(seconds), "minute");
}

/** "42 s", "11 min", "1 h 5 min". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return "";
  }
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}
