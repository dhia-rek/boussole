/** Product identity shown to people (internal ids and env vars keep "forsa"). */
export const BRAND = {
  name: "Boussole",
  taglineFr: "Arrêtez de chercher. Commencez à viser.",
  taglineEn: "Stop searching. Start aiming.",
  author: "Dhia Rekik",
  authorUrl: "https://dhiarekik.me",
  repoUrl: "https://github.com/dhia-rek/forsa",
} as const;

/**
 * Address of the public demo, shown on the landing page of instances that
 * are not themselves the demo (set VITE_BOUSSOLE_DEMO_URL at build time).
 */
export const PUBLIC_DEMO_URL: string | null =
  (import.meta.env.VITE_BOUSSOLE_DEMO_URL as string | undefined)?.trim() ||
  null;
