"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

const STORAGE_KEY = "prism-package-manager";
const EVENT_NAME = "prism-package-manager-change";

function usePackageManager() {
  const [pm, setPm] = useState<PackageManager>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY) as PackageManager | null;
      if (stored && ["npm", "yarn", "pnpm", "bun"].includes(stored)) {
        return stored;
      }
    }
    return "npm";
  });

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<PackageManager>;
      if (custom.detail) setPm(custom.detail);
    };

    const storageHandler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        setPm(e.newValue as PackageManager);
      }
    };

    window.addEventListener(EVENT_NAME, handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);

  const setPmPersisted = (next: PackageManager) => {
    setPm(next);
    localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
  };

  return [pm, setPmPersisted] as const;
}

const managers: PackageManager[] = ["npm", "yarn", "pnpm", "bun"];

function getCommand(pm: PackageManager, pkg: string): string {
  const packages = pkg.split(" ").join(" ");
  switch (pm) {
    case "npm":
      return `npm install ${packages}`;
    case "yarn":
      return `yarn add ${packages}`;
    case "pnpm":
      return `pnpm add ${packages}`;
    case "bun":
      return `bun add ${packages}`;
  }
}

export function InstallTabs({ pkg }: { pkg: string }) {
  const [pm, setPm] = usePackageManager();
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState({
    left: 0,
    width: 0,
    ready: false,
  });

  useEffect(() => {
    let cancelled = false;
    import("shiki")
      .then(({ codeToHtml }) =>
        codeToHtml(getCommand(pm, pkg), { lang: "bash", theme: "github-dark" })
      )
      .then((out) => {
        if (!cancelled) setHtml(out);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pm, pkg]);

  useLayoutEffect(() => {
    const el = buttonRefs.current[pm];
    const container = containerRef.current;
    if (el && container) {
      const cRect = container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setIndicator({
        left: r.left - cRect.left,
        width: r.width,
        ready: true,
      });
    }
  }, [pm]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(getCommand(pm, pkg));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="my-4 overflow-hidden rounded-lg border border-fd-border">
      <div
        ref={containerRef}
        className="relative flex gap-1 border-b border-fd-border bg-fd-muted p-1.5"
      >
        {indicator.ready && (
          <div
            className="absolute top-1.5 bottom-1.5 rounded-md bg-fd-background border border-fd-border shadow-sm transition-all duration-200 ease-out"
            style={{ left: indicator.left, width: indicator.width }}
            aria-hidden
          />
        )}
        {managers.map((m) => (
          <button
            type="button"
            key={m}
            ref={(el) => {
              buttonRefs.current[m] = el;
            }}
            onClick={() => setPm(m)}
            className={`relative z-10 rounded-md px-3 py-1.5 text-xs font-medium border transition-colors duration-150 ${
              pm === m
                ? "border-transparent text-fd-foreground"
                : "border-transparent text-fd-muted-foreground hover:text-fd-foreground"
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="relative bg-[#0d1117] p-0">
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? "Copied" : "Copy"}
          className="absolute right-2 top-2 z-10 inline-flex h-7 items-center rounded-md border border-white/10 bg-white/5 px-2 text-xs font-medium text-white/70 backdrop-blur transition-colors hover:bg-white/10 hover:text-white"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {html ? (
          <div
            className="overflow-x-auto py-4 px-0 text-[13px] leading-[1.6] [&_pre]:!m-0 [&_pre]:!border-0 [&_pre]:!bg-transparent [&_pre]:p-0 [&_pre]:shadow-none [&_code]:!bg-transparent [&_code]:!border-0"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki html is trusted static bash
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="m-0 overflow-x-auto py-4 px-0 text-sm text-[#e6edf3]">
            <code>{getCommand(pm, pkg)}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
