import type React from "react";
import { createContext, useContext, useMemo, useState } from "react";

interface AppShellState {
  /** Whether the full navigation sheet (phones) is open. */
  isNavOpen: boolean;
  setNavOpen: (open: boolean) => void;
}

const AppShellContext = createContext<AppShellState>({
  isNavOpen: false,
  setNavOpen: () => undefined,
});

export const AppShellProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isNavOpen, setNavOpen] = useState(false);
  const value = useMemo(() => ({ isNavOpen, setNavOpen }), [isNavOpen]);
  return (
    <AppShellContext.Provider value={value}>
      {children}
    </AppShellContext.Provider>
  );
};

export function useAppShell(): AppShellState {
  return useContext(AppShellContext);
}
