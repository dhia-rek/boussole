import welcomeMessages from "@shared/messages/jobs-welcome.json";
import { useMemo } from "react";
import { useProfile } from "./useProfile";

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

export function useWelcomeMessage(): string {
  const { personName } = useProfile();

  return useMemo(() => {
    const firstName = personName?.trim().split(/\s+/)[0] || null;
    const today = new Date().toDateString();

    let isFirstDay = true;
    try {
      let firstSeenDate = localStorage.getItem("jobOps_firstWelcomeDate");
      if (!firstSeenDate) {
        firstSeenDate = today;
        localStorage.setItem("jobOps_firstWelcomeDate", today);
      }
      isFirstDay = firstSeenDate === today;
    } catch (_e) {
      // Ignore localStorage errors (e.g. private mode restrictions)
      // Fallback to true so we just show the first message
    }

    // First visit: a welcome, not a "welcome back".
    if (isFirstDay) {
      return firstName
        ? `Welcome, ${firstName}. Let’s find your next job.`
        : "Welcome to Boussole. Let’s find your next job.";
    }

    // Without a name (no CV yet), only lines that need no name.
    const lines = firstName
      ? welcomeMessages.lines
      : welcomeMessages.lines.filter((entry) => entry.placement === "none");
    const seed = Math.abs(hashCode(`${firstName ?? ""}-${today}`));
    const line = lines[seed % lines.length] ?? welcomeMessages.lines[0];

    const name = firstName ?? "";
    switch (line.placement) {
      case "inline":
        return line.text.replace("{name}", name);
      case "prefix":
        return `${name}, ${line.text}`;
      case "suffix":
        return `${line.text}, ${name}.`;
      default:
        return line.text;
    }
  }, [personName]);
}
