import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: ['getting-started/overview', 'getting-started/installation'],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      items: ['core-concepts/manifesto', 'core-concepts/orchestration'],
    },
    {
      type: 'category',
      label: 'Guides',
      items: ['guides/workflow', 'guides/brownfield', 'guides/learning-system'],
    },
    {
      type: 'category',
      label: 'Reference',
      items: ['reference/cli', 'reference/configuration'],
    },
  ],
};

export default sidebars;
