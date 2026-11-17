import { useJobStatusCounts } from "@client/hooks/useJobStatusCounts";
import { Menu } from "lucide-react";
import type React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { BoussoleMark, BoussoleWordmark } from "../brand/BoussoleMark";
import { isNavActive, MOBILE_TAB_LINKS, SETTINGS_LINK } from "../navigation";
import { useAppShell } from "./AppShellContext";
import { NavAccountMenu } from "./NavAccountMenu";
import { formatNavCount, NavGroups, NavLinkItem, navCount } from "./NavLinks";

const TAB_CLASS =
  "flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** Bottom tab bar plus the full navigation sheet on small screens. */
export const MobileNav: React.FC = () => {
  const { pathname } = useLocation();
  const { isNavOpen, setNavOpen } = useAppShell();
  const { counts } = useJobStatusCounts();
  const closeNav = () => setNavOpen(false);

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <ul className="grid h-16 grid-cols-5">
          {MOBILE_TAB_LINKS.map((link) => {
            const active = isNavActive(pathname, link.to, link.activePaths);
            const count = navCount(counts, link.countKey);
            const Icon = link.icon;
            return (
              <li key={link.to}>
                <Link
                  to={link.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    TAB_CLASS,
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <span className="relative">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    {count ? (
                      <span className="absolute -right-3 -top-1.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 tabular-nums text-primary-foreground">
                        {formatNavCount(count)}
                      </span>
                    ) : null}
                  </span>
                  {link.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-expanded={isNavOpen}
              className={cn(TAB_CLASS, "text-muted-foreground")}
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
              More
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={isNavOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          className="flex w-72 flex-col gap-0 p-0"
        >
          <SheetHeader className="border-b border-border/60 px-4 py-3">
            <SheetTitle className="flex items-center gap-2.5">
              <BoussoleMark className="size-8 text-foreground" />
              <BoussoleWordmark className="text-xl" />
            </SheetTitle>
          </SheetHeader>
          <nav
            aria-label="All pages"
            className="flex-1 space-y-4 overflow-y-auto px-2 py-3"
          >
            <NavGroups counts={counts} onNavigate={closeNav} idPrefix="sheet" />
          </nav>
          <div className="space-y-0.5 border-t border-border/60 px-2 py-2">
            <NavLinkItem link={SETTINGS_LINK} onNavigate={closeNav} />
            <NavAccountMenu onAction={closeNav} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};
