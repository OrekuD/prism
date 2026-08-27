import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { InstallTabs } from '@/components/install-tabs';
import { SectionLabel } from '@/components/prism/section-label';
import { StatusBadge } from '@/components/prism/status-badge';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    SectionLabel,
    StatusBadge,
    InstallTabs,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
