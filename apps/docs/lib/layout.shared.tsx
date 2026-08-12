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
    // No header links: the sidebar tree carries the navigation and the
    // overview CTA lives on the homepage hero (review pass).
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
