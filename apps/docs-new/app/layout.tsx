import { RootProvider } from 'fumadocs-ui/provider/next';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './global.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    default: 'Prism Docs',
    template: '%s — Prism Docs',
  },
  description:
    'Documentation for Prism — realtime product analytics for teams, hosted or self-hosted.',
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
