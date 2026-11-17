import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "intro",
    {
      type: "category",
      label: "Getting Started",
      items: [
        "getting-started/self-hosting",
        "getting-started/deploy-server",
        "getting-started/share-online",
        "getting-started/gmail-oauth-setup",
        "getting-started/database-backups",
      ],
    },
    {
      type: "category",
      label: "Workflows",
      items: [
        "workflows/find-jobs-and-apply-workflow",
        "workflows/post-application-workflow",
        "workflows/add-an-extractor",
      ],
    },
    {
      type: "category",
      label: "Core Features",
      items: [
        "features/today",
        "features/overview",
        "features/pipeline-run",
        "features/job-search-bar",
        "features/keyboard-shortcuts",
        "features/multi-select-and-bulk-actions",
        "features/orchestrator",
        "features/design-resume",
        "features/ai-account",
        "features/ai-agents",
        "features/ghostwriter",
        "features/in-progress-board",
        "features/post-application-tracking",
        "features/tracer-links",
        "features/settings",
      ],
    },
    {
      type: "category",
      label: "Job Sources",
      items: [
        "extractors/overview",
        "extractors/welcome-to-the-jungle",
        "extractors/company-career-pages",
        "extractors/jobspy",
        "extractors/adzuna",
        "extractors/hiring-cafe",
        "extractors/startup-jobs",
        "extractors/manual",
      ],
    },
    {
      type: "category",
      label: "Troubleshooting",
      items: ["troubleshooting/common-problems"],
    },
    {
      type: "category",
      label: "Reference / FAQ",
      items: ["reference/faq", "reference/documentation-style-guide"],
    },
  ],
};

export default sidebars;
