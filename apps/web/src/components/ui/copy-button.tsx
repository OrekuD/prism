"use client";

import React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Clipboard write with transient "copied" feedback (1500ms). Every copy
 * affordance in the app uses this hook so the behavior is consistent
 * app-wide.
 */
export function useCopy(value: string) {
  const [copied, setCopied] = React.useState(false);

  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  }, [value]);

  return { copied, onCopy };
}

/**
 * Reusable copy button: on copy the icon flips to a success-colored check
 * and the button tints green, but the label always stays the same
 * (e.g. "Copy" — it never becomes "Copied").
 */
export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const { copied, onCopy } = useCopy(value);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onCopy}
      aria-label={copied ? "Copied" : `Copy ${label}`}
      className={cn(
        copied &&
          "border-success/50 text-success hover:bg-success/10 hover:text-success",
        className,
      )}
    >
      {copied ? (
        <Check className="size-3.5 text-success" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
      {label}
    </Button>
  );
}
