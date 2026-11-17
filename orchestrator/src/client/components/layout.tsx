/**
 * Shared layout components for consistent page structure.
 */

import type { LucideIcon } from "lucide-react";
import type React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { StatusBadgeIndicator } from "./StatusIndicator";

// ============================================================================
// Page Header
// ============================================================================

interface PageHeaderProps {
  icon: LucideIcon | React.FC<{ className?: string }>;
  title: string;
  subtitle: string;
  badge?: string;
  statusIndicator?: React.ReactNode;
  actions?: React.ReactNode;
}

/**
 * Title bar of a page. Navigation lives in the app shell (sidebar / phone
 * tab bar); the header sticks right below the pipeline status bar.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  icon: Icon,
  title,
  subtitle,
  badge,
  statusIndicator,
  actions,
}) => (
  <header
    className="nav-glass sticky z-30"
    style={{ top: "var(--app-header-offset, 0px)" }}
  >
    <div className="container mx-auto flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/30">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 leading-tight">
          <h1 className="truncate text-sm font-semibold tracking-tight">
            {title}
          </h1>
          <div className="truncate text-xs text-muted-foreground">
            {subtitle}
          </div>
        </div>
        {badge && (
          <Badge variant="outline" className="uppercase tracking-wide">
            {badge}
          </Badge>
        )}
        {statusIndicator}
      </div>

      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap sm:justify-end">
        {actions}
      </div>
    </div>
  </header>
);

export const StatusIndicator = StatusBadgeIndicator;

// ============================================================================
// List Panel (left side of split)
// ============================================================================

interface ListPanelProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export const ListPanel: React.FC<ListPanelProps> = ({
  children,
  header,
  footer,
  className,
}) => (
  <div
    className={cn(
      "min-w-0 rounded-xl border border-border/60 bg-card/40 flex flex-col",
      className,
    )}
  >
    {header && (
      <div className="border-b border-border/60 px-4 py-3">{header}</div>
    )}
    <div className="flex-1 divide-y divide-border/60 overflow-y-auto">
      {children}
    </div>
    {footer && (
      <div className="border-t border-border/60 px-4 py-2">{footer}</div>
    )}
  </div>
);

// ============================================================================
// List Item (clickable row in list)
// ============================================================================

interface ListItemProps {
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

export const ListItem: React.FC<ListItemProps> = ({
  selected,
  onClick,
  children,
  className,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "flex w-full items-start gap-4 px-4 py-3 text-left transition-colors",
      selected ? "bg-muted/40" : "hover:bg-muted/30",
      className,
    )}
    aria-pressed={selected}
  >
    {children}
  </button>
);

// ============================================================================
// Empty State
// ============================================================================

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
}) => (
  <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
    {Icon && <Icon className="h-10 w-10 text-muted-foreground/50 mb-2" />}
    <div className="text-base font-semibold">{title}</div>
    {description && (
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
    )}
    {action && <div className="mt-2">{action}</div>}
  </div>
);

const _getScoreTokens = (score: number) => {
  if (score >= 90) return { bar: "bg-emerald-500/80" };
  if (score >= 70) return { bar: "bg-amber-500/80" };
  if (score >= 50) return { bar: "bg-orange-500/80" };
  return { bar: "bg-rose-500/80" };
};

// ============================================================================
// Section Card (for forms, stats, etc.)
// ============================================================================

interface SectionCardProps {
  children: React.ReactNode;
  className?: string;
}

export const SectionCard: React.FC<SectionCardProps> = ({
  children,
  className,
}) => (
  <section
    className={cn(
      "rounded-xl border border-border/60 bg-card/40 p-4",
      className,
    )}
  >
    {children}
  </section>
);

// ============================================================================
// Page Main Content Wrapper
// ============================================================================

interface PageMainProps {
  children: React.ReactNode;
  className?: string;
}

export const PageMain: React.FC<PageMainProps> = ({ children, className }) => (
  <main
    className={cn("container mx-auto space-y-6 px-4 py-6 pb-12", className)}
  >
    {children}
  </main>
);
