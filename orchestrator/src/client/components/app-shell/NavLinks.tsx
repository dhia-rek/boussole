import type { JobStatusCounts } from "@client/hooks/useJobStatusCounts";
import type React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  isNavActive,
  NAV_GROUPS,
  type NavCountKey,
  type NavLink,
} from "../navigation";

export function navCount(
  counts: JobStatusCounts | null,
  key: NavCountKey | undefined,
): number | null {
  if (!counts || !key) return null;
  return key === "ready" ? counts.ready : counts.in_progress;
}

export function formatNavCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

interface NavLinkItemProps {
  link: NavLink;
  collapsed?: boolean;
  count?: number | null;
  onNavigate?: () => void;
}

/** One navigation entry; icon-only with a tooltip when collapsed. */
export const NavLinkItem: React.FC<NavLinkItemProps> = ({
  link,
  collapsed = false,
  count,
  onNavigate,
}) => {
  const { pathname } = useLocation();
  const active = isNavActive(pathname, link.to, link.activePaths);
  const Icon = link.icon;
  const visibleCount = typeof count === "number" && count > 0 ? count : null;

  const item = (
    <Link
      to={link.to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      {active && !collapsed ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary"
        />
      ) : null}
      <Icon
        aria-hidden="true"
        className={cn("h-4 w-4 shrink-0", active && "text-primary")}
      />
      {collapsed ? (
        <span className="sr-only">
          {link.label}
          {visibleCount !== null ? ` (${visibleCount})` : ""}
        </span>
      ) : (
        <span className="truncate">{link.label}</span>
      )}
      {visibleCount !== null && !collapsed ? (
        <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums text-muted-foreground">
          {formatNavCount(visibleCount)}
        </span>
      ) : null}
      {visibleCount !== null && collapsed ? (
        <span
          aria-hidden="true"
          className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-primary"
        />
      ) : null}
    </Link>
  );

  if (!collapsed) return item;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{item}</TooltipTrigger>
      <TooltipContent side="right">
        {link.label}
        {visibleCount !== null ? ` · ${formatNavCount(visibleCount)}` : ""}
      </TooltipContent>
    </Tooltip>
  );
};

interface NavGroupsProps {
  counts: JobStatusCounts | null;
  collapsed?: boolean;
  onNavigate?: () => void;
  idPrefix: string;
}

/** Grouped main navigation shared by the sidebar and the phone sheet. */
export const NavGroups: React.FC<NavGroupsProps> = ({
  counts,
  collapsed = false,
  onNavigate,
  idPrefix,
}) => (
  <>
    {NAV_GROUPS.map((group) => {
      const headingId = group.label ? `${idPrefix}-${group.id}` : undefined;
      return (
        <div key={group.id}>
          {group.label ? (
            collapsed ? (
              <div
                aria-hidden="true"
                className="mx-3 mb-2 border-t border-border/50"
              />
            ) : (
              <p
                id={headingId}
                className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70"
              >
                {group.label}
              </p>
            )
          ) : null}
          <ul
            className="space-y-0.5"
            aria-labelledby={collapsed ? undefined : headingId}
          >
            {group.links.map((link) => (
              <li key={link.to}>
                <NavLinkItem
                  link={link}
                  collapsed={collapsed}
                  count={navCount(counts, link.countKey)}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </div>
      );
    })}
  </>
);
