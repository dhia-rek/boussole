// Analytics disabled — no data is sent anywhere.

export function trackEvent(_event: string, _data?: Record<string, unknown>) {}

export function trackProductEvent(_event: string, _data?: unknown) {}

export function getAnalyticsSessionId(): string | null {
  return null;
}

export function getAnalyticsRequestHeaders(): Record<string, string> {
  return {};
}

export function bucketCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value === 1) return "1";
  if (value <= 5) return "2_5";
  if (value <= 20) return "6_20";
  if (value <= 100) return "21_100";
  return "101_plus";
}

export function bucketClicks(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value === 1) return "1";
  if (value <= 5) return "2_5";
  if (value <= 20) return "6_20";
  if (value <= 50) return "21_50";
  return "51_plus";
}

export function bucketQueryLength(value: string | number): string {
  const length =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? value.length
        : 0;
  if (!Number.isFinite(length) || length <= 0) return "0";
  if (length <= 3) return "1_3";
  if (length <= 10) return "4_10";
  if (length <= 30) return "11_30";
  if (length <= 100) return "31_100";
  return "101_plus";
}
