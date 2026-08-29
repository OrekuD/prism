import { CodeCopyRow } from "@/components/public/code-copy-row";
import { INSTALL_CMDS } from "@/components/sources/constants";
import {
  sdkSnippet,
  sourceSnippetPlatform,
  sourceTypeLabel,
} from "@/lib/sources";
import { cn } from "@/lib/utils";
import React from "react";
import { useNavigate } from "react-router-dom";

function StepRow({
  num,
  label,
  code,
  language,
}: {
  num: string;
  label: string;
  code: string;
  language?: string;
}) {
  return (
    <div className="grid grid-cols-[30px_1fr] gap-2.5">
      <span className="pt-[3px] font-mono text-[11px] font-medium text-text-subtle">
        {num}
      </span>
      <div className="min-w-0">
        <div className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
          {label}
        </div>
        <CodeCopyRow command={code} language={language} />
      </div>
    </div>
  );
}

export function SourceSetup({
  type,
  wrkSlug,
  slug,
}: {
  type: string;
  wrkSlug: string;
  slug: string;
}) {
  const navigate = useNavigate();
  const label = sourceTypeLabel(type);
  const repPlatform = sourceSnippetPlatform(type);
  const endpoint = `${window.location.origin}/api/v2/ingest`;
  const isServer = repPlatform === "server";
  const [framework, setFramework] = React.useState<"javascript" | "react">(
    "javascript"
  );
  const isWeb = type === "web";

  const webInstall =
    framework === "react"
      ? "yarn add @prism-analytics/react @prism-analytics/browser"
      : "yarn add @prism-analytics/browser";
  const webInit =
    framework === "react"
      ? `import { createBrowserClient } from "@prism-analytics/browser";
import { PrismProvider, usePrism } from "@prism-analytics/react";

const prism = await createBrowserClient({
  sourceKey: "psk_YOUR_SOURCE_KEY",
  endpoint: "${window.location.origin}/api/v2/ingest",
});

// Wrap your app
<PrismProvider client={prism}><App /></PrismProvider>

// Then in components
const { track } = usePrism();
track("page_viewed", { url: window.location.href });`
      : sdkSnippet(repPlatform, "psk_YOUR_SOURCE_KEY", endpoint);

  const installCmd = isWeb ? webInstall : (INSTALL_CMDS[repPlatform] ?? "");
  const initCode = isWeb
    ? webInit
    : sdkSnippet(
        repPlatform,
        isServer ? "ssk_YOUR_SOURCE_KEY" : "psk_YOUR_SOURCE_KEY",
        endpoint
      );

  return (
    <div>
      {isWeb ? (
        <div
          role="tablist"
          aria-label="Framework"
          className="flex gap-1 border-b border-border pb-3"
        >
          <button
            type="button"
            role="tab"
            aria-selected={framework === "javascript"}
            onClick={() => setFramework("javascript")}
            className={cn(
              "h-[30px] rounded-[2px] px-3 font-mono text-[12px] transition-colors duration-150",
              framework === "javascript"
                ? "bg-accent text-primary-foreground"
                : "text-text-muted hover:bg-surface-hover hover:text-text"
            )}
          >
            JavaScript
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={framework === "react"}
            onClick={() => setFramework("react")}
            className={cn(
              "h-[30px] rounded-[2px] px-3 font-mono text-[12px] transition-colors duration-150",
              framework === "react"
                ? "bg-accent text-primary-foreground"
                : "text-text-muted hover:bg-surface-hover hover:text-text"
            )}
          >
            React
          </button>
        </div>
      ) : null}
      <div className="mt-6 flex flex-col gap-[18px]">
        <StepRow num="01" label="Install" code={installCmd} />
        <StepRow num="02" label="Initialize" code={initCode} language={framework === "react" ? "tsx" : "typescript"} />
      </div>
      <p className="mt-[18px] flex flex-wrap items-center gap-1.5 text-[12px] text-text-muted">
        Use a key from the{" "}
        <button
          type="button"
          onClick={() =>
            navigate(
              `/workspace/${wrkSlug}/projects/${slug}/sources/${type}/keys`
            )
          }
          className="font-medium text-link transition-colors hover:underline"
        >
          {label} · Keys tab
        </button>{" "}
        when you initialize.
      </p>
    </div>
  );
}

// Re-export for tests or external use if needed
export { StepRow };
