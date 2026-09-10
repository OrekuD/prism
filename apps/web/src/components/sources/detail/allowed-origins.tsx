import { Frame, SectionLabel } from "@/components/public/frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidOrigin } from "@/lib/sources";
import { cn } from "@/lib/utils";
import { useUpdateSourceMutation } from "@/network/mutations/useSourceMutations";
import { TriangleAlert, X } from "@/components/ui/hugeicons";
import React from "react";

export type AllowedOriginsProps = {
  slug: string | undefined;
  sourceId: string;
  initialOrigins: string[];
};

export function AllowedOrigins({
  slug,
  sourceId,
  initialOrigins,
}: AllowedOriginsProps) {
  const updateSource = useUpdateSourceMutation(slug);
  const [origins, setOrigins] = React.useState<string[]>(initialOrigins);
  const [originInput, setOriginInput] = React.useState("");

  React.useEffect(() => {
    setOrigins(initialOrigins);
  }, [initialOrigins]);

  const originInvalid =
    originInput.trim() !== "" && !isValidOrigin(originInput);

  async function addOrigin() {
    const value = originInput.trim();
    if (!value || originInvalid) return;
    const next = origins.includes(value) ? origins : [...origins, value];
    setOrigins(next);
    setOriginInput("");
    await updateSource.mutateAsync({
      sourceId,
      allowedOrigins: next,
    });
  }

  function removeOrigin(origin: string) {
    const next = origins.filter((entry) => entry !== origin);
    setOrigins(next);
    void updateSource.mutateAsync({
      sourceId,
      allowedOrigins: next,
    });
  }

  return (
    <Frame className="p-6">
      <SectionLabel prefix={null}>Allowed Origins</SectionLabel>
      <p className="mt-1.5 text-[13px] text-text-muted">
        Only these origins may send telemetry with this source's publishable key.
      </p>
      <div className="mt-4 space-y-3">
        <div className="flex items-start gap-2">
          <div className="relative flex-1">
            <Input
              value={originInput}
              onChange={(event) => setOriginInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addOrigin();
                }
              }}
              placeholder="https://app.example.com"
              className={cn(
                "w-full pr-9",
                originInvalid && "border-danger focus-visible:ring-danger/30",
              )}
            />
            {originInvalid ? (
              <TriangleAlert
                className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-danger"
                aria-label="Invalid origin"
              />
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void addOrigin()}
            disabled={originInvalid || !originInput.trim()}
          >
            Add
          </Button>
        </div>

        <ul className="space-y-1.5">
          {origins.length === 0 ? (
            <li className="text-[13px] text-text-muted">
              No allowed origins yet.
            </li>
          ) : (
            origins.map((origin) => (
              <li
                key={origin}
                className="flex items-center justify-between gap-2 rounded-[12px] border border-border bg-surface px-3 py-2"
              >
                <code className="truncate font-mono text-[12px] text-text">
                  {origin}
                </code>
                <button
                  type="button"
                  onClick={() => removeOrigin(origin)}
                  aria-label={`Remove ${origin}`}
                  className="shrink-0 text-text-subtle transition-colors hover:text-danger"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </Frame>
  );
}
