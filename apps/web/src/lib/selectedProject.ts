/**
 * Persisted UI selection (localStorage): the last-switched workspace and the
 * last-selected project per workspace. This keeps the sidebar pickers stable
 * across page loads and across non-project pages (where the URL carries no
 * project slug).
 */
const WORKSPACE_KEY = "prism:selectedWorkspaceSlug";
const PROJECTS_KEY = "prism:selectedProjectByWorkspace";

export function getSelectedWorkspaceSlug(): string | null {
  try {
    return localStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
}

export function setSelectedWorkspaceSlug(slug: string | null): void {
  try {
    if (slug) localStorage.setItem(WORKSPACE_KEY, slug);
    else localStorage.removeItem(WORKSPACE_KEY);
  } catch {
    // Storage unavailable (private mode, permissions): selection is best-effort.
  }
}

export function getSelectedProjectSlug(wrkSlug: string): string | null {
  try {
    const map = JSON.parse(
      localStorage.getItem(PROJECTS_KEY) ?? "{}",
    ) as Record<string, string>;
    return map[wrkSlug] ?? null;
  } catch {
    return null;
  }
}

export function setSelectedProjectSlug(
  wrkSlug: string,
  slug: string | null,
): void {
  try {
    const map = JSON.parse(
      localStorage.getItem(PROJECTS_KEY) ?? "{}",
    ) as Record<string, string>;
    if (slug) map[wrkSlug] = slug;
    else delete map[wrkSlug];
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(map));
  } catch {
    // Best-effort.
  }
}
