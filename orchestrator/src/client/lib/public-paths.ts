/** Pages anyone can open without signing in (no API calls that need a session). */
export const PUBLIC_PATHS = ["/welcome"];

/** The root only redirects (to Today or the landing page), so it must not load anything. */
const REDIRECT_ONLY_PATHS = ["/"];

export function isPublicPath(pathname: string): boolean {
  if (REDIRECT_ONLY_PATHS.includes(pathname)) return true;
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}
