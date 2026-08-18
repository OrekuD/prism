import React from "react";
import { useBreadcrumbs } from "@/lib/breadcrumbs";
import { IconMenu } from "./icons";
import {
  Breadcrumb as ShadcnBreadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export function Toolbar({ onMenu }: { onMenu?: () => void }) {
  const trail = useBreadcrumbs();

  return (
    <div className="sticky top-0 z-40 mx-auto flex h-14 w-full max-w-[1800px] items-center justify-between gap-4 border-b border-border bg-canvas px-7">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="hidden size-[30px] items-center justify-center gap-2 rounded-[2px] text-[13px] font-medium transition-colors hover:bg-surface-hover max-[1023px]:inline-flex"
          aria-label="Open navigation"
          onClick={onMenu}
        >
          <IconMenu />
        </button>
        <div className="flex min-w-0 items-center whitespace-nowrap">
          <ShadcnBreadcrumb className="font-mono text-[13px]">
            <BreadcrumbList className="flex-nowrap gap-1.5">
              {trail.map((crumb, index) => {
                const isLast = index === trail.length - 1;
                return (
                  <React.Fragment key={`${crumb.label}-${index}`}>
                    {index > 0 ? (
                      <BreadcrumbSeparator className="text-text-subtle">
                        /
                      </BreadcrumbSeparator>
                    ) : null}
                    <BreadcrumbItem>
                      {isLast ? (
                        <BreadcrumbPage className="text-text">
                          {crumb.label}
                        </BreadcrumbPage>
                      ) : (
                        <span className="text-text-muted max-[767px]:hidden">
                          {crumb.label}
                        </span>
                      )}
                    </BreadcrumbItem>
                  </React.Fragment>
                );
              })}
            </BreadcrumbList>
          </ShadcnBreadcrumb>
        </div>
      </div>
      <div className="flex items-center gap-3">{/* project toolbar actions */}</div>
    </div>
  );
}
