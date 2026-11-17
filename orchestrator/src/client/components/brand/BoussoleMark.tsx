import type React from "react";
import { cn } from "@/lib/utils";

interface BoussoleMarkProps {
  className?: string;
  /** Accessible name; omit when a visible name sits next to the mark. */
  title?: string;
}

/** The compass mark: coral needle pointing north, lilac tail. */
export const BoussoleMark: React.FC<BoussoleMarkProps> = ({
  className,
  title,
}) => (
  <svg
    viewBox="0 0 48 48"
    className={cn("shrink-0", className)}
    role={title ? "img" : undefined}
    aria-hidden={title ? undefined : true}
  >
    {title ? <title>{title}</title> : null}
    <circle
      cx="24"
      cy="24"
      r="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    />
    <path d="M24 8l5 16h-10z" fill="var(--brand-coral)" />
    <path d="M24 40l-5-16h10z" fill="currentColor" fillOpacity="0.55" />
    <circle
      cx="24"
      cy="24"
      r="2.5"
      fill="var(--brand-indigo)"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

/** "Bous" + coral "sole" in the display face. */
export const BoussoleWordmark: React.FC<{ className?: string }> = ({
  className,
}) => (
  <span
    className={cn("font-display font-extrabold tracking-[-0.035em]", className)}
  >
    Bous<span className="text-brand-coral">sole</span>
  </span>
);
