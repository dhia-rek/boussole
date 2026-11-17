import type { NextFunction, Request, Response } from "express";

const HSTS_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/** True for HTTPS requests, including ones terminated by a local tunnel. */
function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const forwarded = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return proto?.split(",")[0]?.trim() === "https";
}

/**
 * Baseline browser protections for every response: no MIME sniffing, no
 * framing by other sites, a tight referrer policy, camera/microphone only
 * for Forsa itself (mock interviews), and HSTS once served over HTTPS.
 */
export function securityHeaders() {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
    );
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    if (isHttpsRequest(req)) {
      res.setHeader(
        "Strict-Transport-Security",
        `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`,
      );
    }
    next();
  };
}
