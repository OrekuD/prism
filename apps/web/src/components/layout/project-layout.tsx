import React from "react";
import { Outlet, useParams, useSearchParams } from "react-router-dom";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import type { ProjectDetailedRequest } from "@prism-analytics/types";

/**
 * Project route shell (v2 dashboard): the sidebar owns project navigation
 * (Overview / Data / Configure), so this layout does not duplicate a
 * horizontal tab row in the content. It only guards the project's
 * existence and renders the current view's Outlet.
 */
export function ProjectLayout() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const duration = searchParams.get(
    "duration",
  ) as ProjectDetailedRequest["duration"];
  const projectQuery = useProjectQuery({ slug, duration });

  if (!projectQuery.isLoading && !projectQuery.data) {
    return (
      <div className="grid min-h-[40vh] place-items-center text-center gap-3 text-sm">
        <p className="mono subtle">Project not found.</p>
      </div>
    );
  }

  return <Outlet />;
}
