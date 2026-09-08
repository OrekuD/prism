import { CodeCopyRow } from "@/components/public/code-copy-row";
import { Frame, SectionLabel } from "@/components/public/frame";
import { Badge } from "@/components/ui/badge";
import { PLATFORM_LABELS, sdkSnippet } from "@/lib/sources";
import { cn } from "@/lib/utils";
import React from "react";

type SetupFramework = "javascript" | "react";

export type SdkSetupProps = {
  platform: string;
  endpoint: string;
  snippetKey: string;
};

export function SdkSetup({ platform, endpoint, snippetKey }: SdkSetupProps) {
  const [setupFramework, setSetupFramework] =
    React.useState<SetupFramework>("javascript");

  return (
    <Frame className="p-6">
      <SectionLabel>SDK Setup</SectionLabel>
      <p className="mt-1.5 text-[13px] text-text-muted">
        The snippet shows a placeholder — the source's{" "}
        {platform === "server" ? "secret" : "publishable"} key is shown once at
        creation.
      </p>
      {platform === "web" ? (
        <div
          role="tablist"
          aria-label="Framework"
          className="mt-0 flex gap-1 border-b border-border pb-3"
        >
          <button
            type="button"
            role="tab"
            aria-selected={setupFramework === "javascript"}
            onClick={() => setSetupFramework("javascript")}
            className={cn(
              "h-[30px] rounded-full px-3 text-[12px] transition-colors duration-150",
              setupFramework === "javascript"
                ? "bg-accent text-primary-foreground"
                : "text-text-muted hover:bg-surface-hover hover:text-text"
            )}
          >
            JavaScript
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={setupFramework === "react"}
            onClick={() => setSetupFramework("react")}
            className={cn(
              "h-[30px] rounded-full px-3 text-[12px] transition-colors duration-150",
              setupFramework === "react"
                ? "bg-accent text-primary-foreground"
                : "text-text-muted hover:bg-surface-hover hover:text-text"
            )}
          >
            React
          </button>
        </div>
      ) : null}
      <div className="mt-4">
        {snippetKey ? (
          <div className="space-y-2">
            <CodeCopyRow
              command={
                platform === "web" && setupFramework === "react"
                  ? `import { createBrowserClient } from "@prism-analytics/browser";
import { PrismProvider, usePrism } from "@prism-analytics/react";

const prism = await createBrowserClient({
  sourceKey: "psk_YOUR_SOURCE_KEY",
  endpoint: "${endpoint}",
});

// Wrap your app
<PrismProvider client={prism}><App /></PrismProvider>

// Then in components
const { track } = usePrism();
track("page_viewed", { url: window.location.href });`
                  : sdkSnippet(
                      platform,
                      platform === "server"
                        ? "ssk_YOUR_SOURCE_KEY"
                        : "psk_YOUR_SOURCE_KEY",
                      endpoint
                    )
              }
            />
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Badge variant="outline">{PLATFORM_LABELS[platform]}</Badge>
              <span>
                {platform === "web"
                  ? "Publishable key — origin-policed by this project's allowed origins."
                  : platform === "server"
                    ? "Secret key — never appears in client bundles."
                    : "Publishable key — telemetry-write-only."}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-text-muted">
            No active publishable key — create one to generate the setup
            snippet.
          </p>
        )}
      </div>
    </Frame>
  );
}
