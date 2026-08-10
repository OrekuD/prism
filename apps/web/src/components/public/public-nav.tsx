import { Menu, X } from "lucide-react";
import React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

const VITE_DOCS_URL: string = import.meta.env.VITE_DOCS_URL ?? "http://localhost:4321";

const navLinks = [
  { label: "Product", to: "/#product" },
  { label: "Docs", href: `${VITE_DOCS_URL}` },
  { label: "Self-host", to: "/#self-host" },
];

/**
 * Global public navigation (design-system.md 9.1): 2px accent top rail,
 * 72px bar, wordmark left, links center-right, Sign in ghost + white pill
 * CTA right. Mobile collapses to a full-width sheet below the bar.
 */
export function PublicNav() {
  const [open, setOpen] = React.useState(false);

  return (
    <header>
      <div aria-hidden="true" className="h-[2px] bg-accent" />
      <nav
        aria-label="Public"
        className="relative border-b border-border bg-canvas"
      >
        <div className="mx-auto flex h-[72px] max-w-[1200px] items-center justify-between px-8">
          <Link
            to="/"
            className="flex items-center gap-2 font-mono text-[15px] font-semibold tracking-tight text-text"
            onClick={() => setOpen(false)}
          >
            <span aria-hidden="true" className="size-2 bg-accent" />
            Prism
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            {navLinks.map((link) =>
              "href" in link ? (
                <a
                  key={link.label}
                  href={link.href}
                  className="text-[13px] text-text-muted transition-colors duration-150 hover:text-text"
                >
                  {link.label}
                </a>
              ) : (
                <a
                  key={link.label}
                  href={link.to}
                  className="text-[13px] text-text-muted transition-colors duration-150 hover:text-text"
                >
                  {link.label}
                </a>
              ),
            )}
          </div>

          <div className="hidden items-center gap-6 md:flex">
            <Link
              to="/auth/log-in"
              className="text-[13px] font-medium text-text-muted transition-colors duration-150 hover:text-text"
            >
              Sign in
            </Link>
            <Link
              to="/auth/create-account"
              className="inline-flex h-[38px] items-center rounded-full bg-[#f2f2f4] px-5 text-[13px] font-medium text-text-inverse transition-colors duration-150 hover:bg-white"
            >
              Get started
            </Link>
          </div>

          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
            className="grid size-10 place-items-center text-text-muted hover:text-text md:hidden"
          >
            {open ? (
              <X className="size-5" aria-hidden="true" />
            ) : (
              <Menu className="size-5" aria-hidden="true" />
            )}
          </button>
        </div>

        {open ? (
          <div className="border-t border-border md:hidden">
            <div className="mx-auto max-w-[1200px] px-6">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={"href" in link ? link.href : link.to}
                  onClick={() => setOpen(false)}
                  className="flex h-12 items-center border-b border-border text-[14px] text-text-muted hover:text-text"
                >
                  {link.label}
                </a>
              ))}
              <Link
                to="/auth/log-in"
                onClick={() => setOpen(false)}
                className="flex h-12 items-center border-b border-border text-[14px] text-text-muted hover:text-text"
              >
                Sign in
              </Link>
              <Link
                to="/auth/create-account"
                onClick={() => setOpen(false)}
                className={cn(
                  "my-4 flex h-11 items-center justify-center rounded-full",
                  "bg-[#f2f2f4] text-[14px] font-medium text-text-inverse",
                )}
              >
                Get started
              </Link>
            </div>
          </div>
        ) : null}
      </nav>
    </header>
  );
}
