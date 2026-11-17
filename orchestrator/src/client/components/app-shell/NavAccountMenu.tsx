import { logout } from "@client/api";
import { useVersionCheck } from "@client/hooks/useVersionCheck";
import {
  loadRememberedAuthUsers,
  type RememberedAuthUser,
} from "@client/lib/remembered-auth-users";
import { BookOpen, LogOut, Tag, UserRound } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const RELEASES_URL = "https://github.com/dhia-rek/boussole/releases";

function buildSignInPath(username: string, nextPath: string): string {
  const params = new URLSearchParams();
  params.set("user", username);
  if (
    nextPath &&
    nextPath !== "/sign-in" &&
    !nextPath.startsWith("/sign-in?")
  ) {
    params.set("next", nextPath);
  }
  return `/sign-in?${params.toString()}`;
}

interface NavAccountMenuProps {
  /** Icon-only trigger for the collapsed sidebar. */
  collapsed?: boolean;
  /** Called before any action, e.g. to close the phone navigation sheet. */
  onAction?: () => void;
}

/** Account switcher, sign-out, documentation and version. */
export const NavAccountMenu: React.FC<NavAccountMenuProps> = ({
  collapsed = false,
  onAction,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { version, updateAvailable } = useVersionCheck();
  const [rememberedUsers, setRememberedUsers] = useState<RememberedAuthUser[]>(
    [],
  );

  const handleSwitchUser = async (username: string) => {
    onAction?.();
    await logout({ redirect: false });
    navigate(buildSignInPath(username, location.pathname), { replace: true });
  };

  const handleSignOut = async () => {
    onAction?.();
    await logout();
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) setRememberedUsers(loadRememberedAuthUsers());
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-9 w-full justify-start gap-3 px-3 text-sm font-medium text-muted-foreground hover:text-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
          {collapsed ? (
            <span className="sr-only">Account</span>
          ) : (
            <span className="truncate">Account</span>
          )}
          {updateAvailable ? (
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full bg-emerald-500",
                !collapsed && "ml-auto",
              )}
              title="Update available"
            />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel>Switch account</DropdownMenuLabel>
        {rememberedUsers.length > 0 ? (
          rememberedUsers.map((user) => (
            <DropdownMenuItem
              key={user.username}
              onSelect={() => void handleSwitchUser(user.username)}
              className="flex min-w-0 items-start gap-2"
            >
              <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {user.displayName ?? user.username}
                </span>
                {user.displayName ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {user.username}
                  </span>
                ) : null}
              </span>
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>
            Sign in once to remember a username here.
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2"
          onSelect={() => {
            onAction?.();
            window.open("/docs", "_blank", "noopener,noreferrer");
          }}
        >
          <BookOpen className="h-3.5 w-3.5" />
          <span>Documentation</span>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="gap-2">
          <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
            <Tag className="h-3.5 w-3.5" />
            <span>
              Version {version}
              {updateAvailable ? " · update available" : ""}
            </span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void handleSignOut()}
          className="gap-2"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
