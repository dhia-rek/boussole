import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

const siteUrl =
  process.env.DOCS_SITE_URL ??
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3006"
    : "http://localhost:5173");
const configuredBaseUrl = process.env.DOCS_BASE_URL ?? "/docs/";
const normalizedBaseUrl = configuredBaseUrl.startsWith("/")
  ? configuredBaseUrl
  : `/${configuredBaseUrl}`;
const siteBaseUrl = normalizedBaseUrl.endsWith("/")
  ? normalizedBaseUrl
  : `${normalizedBaseUrl}/`;

const config: Config = {
  title: "Forsa — Docs",
  tagline: "Your job search, supercharged",
  favicon: "img/favicon.png",
  future: {
    v4: true,
  },
  url: siteUrl,
  baseUrl: siteBaseUrl,
  onBrokenLinks: "warn",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },
  themes: [
    [
      require.resolve("@easyops-cn/docusaurus-search-local"),
      {
        hashed: true,
        indexDocs: true,
        indexBlog: false,
        indexPages: false,
        docsRouteBasePath: "/",
        searchResultLimits: 8,
        searchResultContextMaxLength: 50,
        explicitSearchResultPath: true,
      },
    ],
  ],
  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/dhia-rek/forsa/tree/main/docs-site/",
          showLastUpdateAuthor: false,
          showLastUpdateTime: false,
          // Single living doc, no versioned snapshots committed.
          includeCurrentVersion: true,
        },
        blog: false,
        pages: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    navbar: {
      title: "Forsa Docs",
      logo: {
        alt: "Forsa",
        src: "img/favicon.png",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Documentation",
        },
        {
          type: "html",
          value:
            '<a class="navbar__item navbar__link" href="/overview">Back to App</a>',
          position: "right",
        },
        {
          type: "html",
          value:
            '<a class="navbar__item navbar__link" href="https://github.com/dhia-rek/forsa">GitHub</a>',
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Introduction", to: "/" },
            { label: "Getting Started", to: "/getting-started/self-hosting" },
          ],
        },
        {
          title: "Project",
          items: [
            {
              label: "Repository",
              href: "https://github.com/dhia-rek/forsa",
            },
            {
              label: "Issues",
              href: "https://github.com/dhia-rek/forsa/issues",
            },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Dhia Rekik — Forsa`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
