import {
  BarChart3,
  Columns3,
  FilePenLine,
  Home,
  Inbox,
  LayoutDashboard,
  Link2,
  Send,
  Settings,
} from "lucide-react";

/** Live counts that can be shown next to a navigation link. */
export type NavCountKey = "ready" | "inProgress";

export type NavLink = {
  to: string;
  label: string;
  icon: typeof Home;
  /** Path prefixes (besides `to`) that mark the link as active. */
  activePaths?: string[];
  countKey?: NavCountKey;
};

export type NavGroup = {
  id: string;
  /** Section title; `null` renders the links without a heading. */
  label: string | null;
  links: NavLink[];
};

const TODAY: NavLink = { to: "/today", label: "Today", icon: Home };
const JOBS: NavLink = {
  to: "/jobs/ready",
  label: "Jobs",
  icon: LayoutDashboard,
  activePaths: ["/jobs", "/job"],
  countKey: "ready",
};
const APPLICATIONS: NavLink = {
  to: "/applications/in-progress",
  label: "Applications",
  icon: Columns3,
  activePaths: ["/applications"],
  countKey: "inProgress",
};
const CV: NavLink = { to: "/design-resume", label: "CV", icon: FilePenLine };

/** Main navigation, grouped by step of the job search. */
export const NAV_GROUPS: NavGroup[] = [
  { id: "home", label: null, links: [TODAY] },
  {
    id: "find",
    label: "Find",
    links: [JOBS, { to: "/spontaneous", label: "Spontaneous", icon: Send }],
  },
  {
    id: "apply",
    label: "Apply",
    links: [
      APPLICATIONS,
      { to: "/tracking-inbox", label: "Inbox", icon: Inbox },
    ],
  },
  { id: "profile", label: "Profile", links: [CV] },
  {
    id: "insights",
    label: "Insights",
    links: [
      { to: "/overview", label: "Analytics", icon: BarChart3 },
      { to: "/tracer-links", label: "Tracer links", icon: Link2 },
    ],
  },
];

export const SETTINGS_LINK: NavLink = {
  to: "/settings",
  label: "Settings",
  icon: Settings,
};

/** Every navigation destination, in display order. */
export const NAV_LINKS: NavLink[] = [
  ...NAV_GROUPS.flatMap((group) => group.links),
  SETTINGS_LINK,
];

/** Phone bottom bar: the most used pages; everything else sits under "More". */
export const MOBILE_TAB_LINKS: NavLink[] = [TODAY, JOBS, APPLICATIONS, CV];

export const isNavActive = (
  pathname: string,
  to: string,
  activePaths?: string[],
) => {
  if (pathname === to) return true;
  if (!activePaths) return false;
  return activePaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
};
