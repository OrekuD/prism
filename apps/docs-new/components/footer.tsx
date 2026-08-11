import Link from 'next/link';
import { cn } from '@/lib/cn';

const FOOTER_LINKS = [
  { label: 'Docs home', href: '/' },
  { label: 'Hosted or self-hosted', href: '/docs/start/choose' },
  { label: 'Self-hosting', href: '/docs/self-hosting/evaluation/overview' },
  { label: 'Security', href: '/docs/operations/security' },
  { label: 'GitHub', href: 'https://github.com/OrekuD/prism', external: true },
  {
    label: 'License',
    href: 'https://github.com/OrekuD/prism/blob/main/LICENSE',
    external: true,
  },
];

/**
 * Prism footer (framed, mono links). Rendered inside the docs main column
 * (`fullBleed` stretches it edge-to-edge over the column padding) and at the
 * bottom of the homepage.
 */
export function PrismFooter({ fullBleed }: { fullBleed?: boolean }) {
  return (
    <footer
      className={cn(
        'border-t border-fd-border',
        fullBleed && '-mx-6 mt-auto',
      )}
    >
      <div className="mx-auto flex w-full max-w-(--fd-layout-width) flex-col gap-6 px-6 py-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="font-semibold text-fd-foreground">Prism</p>
            <p className="mt-1 max-w-[36ch] text-[13px] leading-relaxed text-fd-muted-foreground">
              Realtime product analytics for teams — hosted or self-hosted.
            </p>
          </div>
          <nav
            aria-label="Footer"
            className="flex flex-wrap gap-x-6 gap-y-1.5"
          >
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                target={link.external ? '_blank' : undefined}
                rel={link.external ? 'noreferrer noopener' : undefined}
                className="font-mono text-[11px] uppercase tracking-[0.06em] text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <p className="border-t border-fd-border pt-4 font-mono text-[11px] text-fd-muted-foreground/70">
          © 2026 Prism contributors · Built with Fumadocs · All assets are
          served from this origin — no third-party requests.
        </p>
      </div>
    </footer>
  );
}
