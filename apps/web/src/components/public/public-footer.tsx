import { PrismLogo } from "@/components/brand/prism-logo";

import { DOCS_URL } from "@/lib/docs";

const columns = [
  {
    title: "Product",
    links: [
      { label: "Live activity", href: `${DOCS_URL}/docs/features/sessions-and-live-activity` },
      { label: "Event explorer", href: `${DOCS_URL}/docs/features/capturing-events` },
      { label: "Self-host", href: `${DOCS_URL}/docs/self-hosting/self-host-prism` },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: DOCS_URL },
      { label: "Quickstart", href: `${DOCS_URL}/docs/start/quickstart` },
      { label: "SDK reference", href: `${DOCS_URL}/docs/start/javascript-sdk` },
    ],
  },
  {
    title: "Project",
    links: [{ label: "GitHub", href: "https://github.com/OrekuD/prism" }],
  },
];

/** Compact public footer (design-system.md 10.6): docs, source, legal. */
export function PublicFooter() {
  return (
    <footer className="border-t border-border">
      <div className="grid gap-10 px-6 py-12 sm:grid-cols-2 lg:grid-cols-4 lg:px-10">
        <div>
          <p className="flex items-center text-text">
            <PrismLogo size={18} />
          </p>
          <p className="mt-3 max-w-[28ch] text-[13px] leading-relaxed text-text-muted">
            Realtime product analytics you can run with us or on your own
            infrastructure.
          </p>
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-subtle">
              {column.title}
            </p>
            <ul className="mt-4 grid gap-2.5">
              {column.links.map((link) => {
                const isExternal = link.href.startsWith("http");
                return (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={isExternal ? "_blank" : undefined}
                      rel={isExternal ? "noreferrer" : undefined}
                      className="text-[13px] text-text-muted transition-colors duration-150 hover:text-text hover:underline"
                    >
                      {link.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-6 py-4 lg:px-10">
        <p className="text-[12px] text-text-subtle">
          © {new Date().getFullYear()} Prism
        </p>
      </div>
    </footer>
  );
}
