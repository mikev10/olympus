import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { themes as prismThemes } from 'prism-react-renderer';

const config: Config = {
  title: 'Olympus Documentation',
  tagline: 'Multi-Agent Orchestration for Claude Code',
  favicon: 'img/favicon.ico',

  url: 'https://docs.olympusai.dev',
  baseUrl: '/',

  organizationName: 'mikev10',
  projectName: 'olympus',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: 'content',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          includeCurrentVersion: true,
          editUrl: 'https://github.com/mikev10/olympus/tree/main/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['en'],
        highlightSearchTermsOnTargetPage: true,
        docsRouteBasePath: '/',
        docsDir: 'content',
        blogDir: [],
      },
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: false,
    },

    navbar: {
      title: 'Olympus',
      items: [
        {
          to: '/getting-started/overview',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://olympusai.dev',
          label: 'olympusai.dev',
          position: 'right',
        },
        {
          href: 'https://www.npmjs.com/package/olympus-ai',
          label: 'npm',
          position: 'right',
        },
        {
          href: 'https://github.com/mikev10/olympus',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },

    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Overview',
              to: '/getting-started/overview',
            },
            {
              label: 'Installation',
              to: '/getting-started/installation',
            },
            {
              label: 'CLI Reference',
              to: '/reference/cli',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/mikev10/olympus',
            },
            {
              label: 'npm',
              href: 'https://www.npmjs.com/package/olympus-ai',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Marketing Site',
              href: 'https://olympusai.dev',
            },
            {
              label: 'MIT License',
              href: 'https://github.com/mikev10/olympus/blob/main/LICENSE',
            },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} Olympus. Built with Docusaurus.`,
    },

    prism: {
      theme: prismThemes.dracula,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
