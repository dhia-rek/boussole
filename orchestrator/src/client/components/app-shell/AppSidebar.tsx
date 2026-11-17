import { useJobStatusCounts } from "@client/hooks/useJobStatusCounts";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BoussoleMark, BoussoleWordmark } from "../brand/BoussoleMark";
import { SETTINGS_LINK } from "../navigation";
import { NavAccountMenu } from "./NavAccountMenu";
import { NavGroups, NavLinkItem } from "./NavLinks";

export const SIDEBAR_COLLAPSED_STORAGE_KEY = "boussole.sidebar.collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      collapsed ? "1" : "0",
    );
  } catch {
    // Storage can be unavailable (private mode); the choice just won't persist.
  }
}

/** Always-visible navigation on large screens. */
export const AppSidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { counts } = useJobStatusCounts();

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      writeCollapsed(!current);
      return !current;
    });
  };

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border/60 bg-card/40 transition-[width] duration-200 lg:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-border/60 px-4",
          collapsed && "justify-center px-0",
        )}
      >
        <Link
          to="/today"
          className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BoussoleMark className="size-8 text-foreground" />
          <BoussoleWordmark
            className={cn("truncate text-xl", collapsed && "sr-only")}
          />
        </Link>
      </div>

      <nav
        aria-label="Main"
        className="flex-1 space-y-4 overflow-y-auto px-2 py-3"
      >
        <NavGroups counts={counts} collapsed={collapsed} idPrefix="sidebar" />
      </nav>

      <div className="space-y-0.5 border-t border-border/60 px-2 py-2">
        <NavLinkItem link={SETTINGS_LINK} collapsed={collapsed} />
        <NavAccountMenu collapsed={collapsed} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "h-8 w-full justify-start gap-3 px-3 text-xs text-muted-foreground hover:text-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" aria-hidden="true" />
          ) : (
            <>
              <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
              <span>Collapse</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  );
};
