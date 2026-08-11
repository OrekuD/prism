import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitConfig } from './shared';
import { PrismLogo } from '@/components/logo';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <PrismLogo />,
      url: '/',
      transparentMode: 'top',
    },
    links: [
      { type: 'main', text: 'Start', url: '/docs/start/overview' },
      { type: 'main', text: 'Hosted', url: '/docs/hosted/quickstart' },
      {
        type: 'main',
        text: 'Self-hosting',
        url: '/docs/self-hosting/evaluation/overview',
      },
      { type: 'main', text: 'SDKs', url: '/docs/sdks/javascript' },
      { type: 'main', text: 'API', url: '/docs/api-reference/ingestion' },
      { type: 'main', text: 'Operations', url: '/docs/operations/health' },
      { type: 'main', text: 'Contributing', url: '/docs/contributing/development' },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
