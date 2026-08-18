import React from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Check, LogOut, Monitor, Plus, ShieldCheck, Sun, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import { authClient } from "@/lib/authClient";
import { useActiveWorkspace, useWorkspaces, workspaceActions } from "@/lib/workspace";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";
import { getInitials } from "@/utils/getInitials";
import { PrismLogo } from "@/components/brand/prism-logo";
import { CreateWorkspaceDialog } from "@/components/layout/workspace-switcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as I from "./icons";

const VITE_DOCS_URL: string =
  import.meta.env.VITE_DOCS_URL ?? "http://localhost:3000";

const LINK_BASE =
  "relative flex h-9 items-center gap-2.5 rounded-[2px] px-3 text-[13px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text";
const LINK_ACTIVE =
  "bg-accent-soft font-medium text-text before:absolute before:-left-3 before:top-0 before:bottom-0 before:w-0.5 before:bg-accent";

function Active({
  to,
  label,
  icon,
  className,
  end,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  className?: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(LINK_BASE, isActive && LINK_ACTIVE, className)
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

function SoonLink({ label }: { label: string }) {
  return (
    <span className={cn(LINK_BASE, "cursor-default text-text-subtle hover:bg-transparent hover:text-text-subtle")} title={`${label} — coming soon`}>
      {SOON_ICONS[label]}
      {label}
    </span>
  );
}

export function Sidebar({ navOpen }: { navOpen?: boolean }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { data: session } = authClient.useSession();
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: workspaces, isPending: workspacesPending } = useWorkspaces();
  const projectsQuery = useProjectsQuery();

  const wrkSlug = (activeWorkspace as { slug?: string } | null)?.slug ?? "";
  const pathSegments = pathname.split("/");
  const slug = pathSegments[2] === "projects" ? pathSegments[3] : undefined;
  const project = projectsQuery.data?.find((entry) => entry.slug === slug);
  const workspaceName = (activeWorkspace as { name?: string } | null)?.name;
  const allWorkspaces = (workspaces ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
  }>;
  const activeWorkspaceId = (activeWorkspace as { id?: string } | null)?.id;
  const [newWorkspaceOpen, setNewWorkspaceOpen] = React.useState(false);
  const projects = (projectsQuery.data ?? []) as Array<{ name: string; slug: string }>;

  const themeOptions = [
    { value: "light" as const, label: "Light", Icon: Sun },
    { value: "dark" as const, label: "Dark", Icon: I.IconMoon },
    { value: "system" as const, label: "System", Icon: Monitor },
  ];
  const themeLabel =
    theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System";

  return (
    <aside
      id="sidebar"
      aria-label="Workspace navigation"
      className={cn(
        "sticky top-0 z-60 flex h-dvh w-[240px] shrink-0 flex-col border-r border-border bg-canvas-subtle",
        "max-[1023px]:fixed max-[1023px]:bottom-0 max-[1023px]:left-0 max-[1023px]:top-0 max-[1023px]:z-60 max-[1023px]:-translate-x-full max-[1023px]:transition-transform max-[1023px]:duration-200 max-[1023px]:ease-out",
        navOpen && "max-[1023px]:translate-x-0 max-[1023px]:shadow-[16px_0_48px_rgb(0_0_0/0.45)]",
      )}
    >
      <div className="flex items-center px-3 pb-2.5 pt-3.5">
        <Link to={`/${wrkSlug}/overview`} aria-label="Prism home" className="inline-flex items-center gap-2.5 rounded-[2px] transition-opacity hover:opacity-90">
          <PrismLogo size={22} variant="monochrome" className="text-text" />
        </Link>
      </div>

      <div className="px-3 pb-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-haspopup="menu"
              title="Switch workspace"
              className="flex h-[34px] w-full items-center gap-2 rounded-[2px] border border-border bg-surface px-2.5 text-[13px] font-medium transition-colors hover:bg-surface-hover"
            >
              <span className="flex-1 truncate text-left">
                {workspacesPending ? (
                  <span
                    className="inline-block h-[13px] w-28 animate-pulse rounded-[2px] bg-surface-raised"
                    aria-hidden="true"
                  />
                ) : (
                  workspaceName ?? "Select a workspace"
                )}
              </span>
              <I.IconChevronDown />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={6} className="w-(--radix-dropdown-menu-trigger-width)">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {allWorkspaces.length === 0 ? (
              <div className="px-2 py-1.5 text-[13px] text-text-subtle">
                No workspaces yet.
              </div>
            ) : (
              allWorkspaces.map((ws) => (
                <DropdownMenuItem
                  key={ws.id}
                  className="gap-2"
                  onClick={() => {
                    if (ws.id !== activeWorkspaceId) {
                      void workspaceActions.setActive(ws.id);
                      navigate(`/${ws.slug}/overview`);
                    }
                  }}
                >
                  <span className="flex-1 truncate">{ws.name}</span>
                  {activeWorkspaceId === ws.id ? (
                    <Check className="size-3.5 text-accent" />
                  ) : null}
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2"
              onClick={() => setNewWorkspaceOpen(true)}
            >
              <Plus className="size-4" />
              <span className="flex-1">New workspace</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CreateWorkspaceDialog
          open={newWorkspaceOpen}
          onOpenChange={setNewWorkspaceOpen}
        />
      </div>

      <nav className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 pb-4">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 px-1 pb-1.5 pt-1 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
            Workspace
          </div>
          <Active to={`/${wrkSlug}/overview`} label="Workspace overview" icon={<I.IconGrid />} end />
          <Active to={`/${wrkSlug}/projects`} label="Projects" icon={<I.IconFolder />} />
          <Active to={`/${wrkSlug}/members`} label="Members" icon={<I.IconUsers />} />
          <Active to={`/${wrkSlug}/settings`} label="Settings" icon={<I.IconSettings />} />
        </div>

        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 px-1 pb-1.5 pt-1 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
            Project
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-haspopup="menu"
                className="mb-2 flex h-[34px] w-full items-center gap-2 rounded-[2px] border border-border bg-surface px-2.5 text-[13px] font-medium transition-colors hover:bg-surface-hover"
              >
                <I.IconFolder />
                <span className="flex-1 truncate text-left">
                  {projectsQuery.isLoading ? (
                    <span
                      className="inline-block h-[13px] w-20 animate-pulse rounded-[2px] bg-surface-raised"
                      aria-hidden="true"
                    />
                  ) : (
                    project?.name ?? workspaceName ?? "Select a project"
                  )}
                </span>
                <I.IconChevronDown />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={6} className="w-(--radix-dropdown-menu-trigger-width)">
              <DropdownMenuLabel>Projects</DropdownMenuLabel>
              {projects.length === 0 ? (
                <div className="px-2 py-1.5 text-[13px] text-text-subtle">
                  No projects yet.
                </div>
              ) : (
                projects.map((entry) => (
                  <DropdownMenuItem
                    key={entry.slug}
                    onClick={() => navigate(`/${wrkSlug}/projects/${entry.slug}`)}
                    className="gap-2"
                  >
                    <I.IconFolder />
                    <span className="flex-1 truncate">{entry.name}</span>
                    {entry.slug === slug ? (
                      <Check className="size-3.5 text-accent" />
                    ) : null}
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => navigate(`/${wrkSlug}/projects/new`)}
                className="gap-2"
              >
                <Plus className="size-4" />
                <span className="flex-1">New project</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {project ? (
            <Active to={`/${wrkSlug}/projects/${project.slug}`} end label="Overview" icon={<I.IconChart />} />
          ) : null}
        </div>

        {slug ? (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 px-1 pb-1.5 pt-1 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
              Data
            </div>
            <Active to={`/${wrkSlug}/projects/${slug}/events`} label="Events" icon={<I.IconBolt />} />
            <Active to={`/${wrkSlug}/projects/${slug}/people`} label="People" icon={<I.IconPerson />} />
            <Active to={`/${wrkSlug}/projects/${slug}/realtime`} label="Live" icon={<I.IconGlobe />} />
          </div>
        ) : null}

        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 px-1 pb-1.5 pt-1 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
            Analyze <span className="ml-auto rounded-[2px] border border-border px-[5px] py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-text-subtle">soon</span>
          </div>
          {SOON_ANALYZE.map((item) => <SoonLink key={item} label={item} />)}
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 px-1 pb-1.5 pt-1 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
            Diagnose <span className="ml-auto rounded-[2px] border border-border px-[5px] py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-text-subtle">soon</span>
          </div>
          {SOON_DIAGNOSE.map((item) => <SoonLink key={item} label={item} />)}
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 px-1 pb-1.5 pt-1 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
            Ship <span className="ml-auto rounded-[2px] border border-border px-[5px] py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-text-subtle">soon</span>
          </div>
          {SOON_SHIP.map((item) => <SoonLink key={item} label={item} />)}
        </div>

        {slug ? (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 px-1 pb-1.5 pt-1 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
              Configure
            </div>
            <Active to={`/${wrkSlug}/projects/${slug}/sources`} label="Sources" icon={<I.IconGlobe />} />
            <Active to={`/${wrkSlug}/projects/${slug}/settings`} label="Settings" icon={<I.IconSettings />} />
          </div>
        ) : null}
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-border px-3 pb-3.5 pt-2.5">
        <a className={LINK_BASE} href={VITE_DOCS_URL} target="_blank" rel="noreferrer">
          <I.IconDoc />Docs
        </a>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-haspopup="menu"
              className={cn(LINK_BASE, "w-full")}
            >
              <I.IconMoon />
              <span className="flex-1 text-left">Theme</span>
              <span className="font-mono text-[11px] text-text-subtle">
                {themeLabel}
              </span>
              <I.IconChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={6} className="w-(--radix-dropdown-menu-trigger-width)">
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            {themeOptions.map((option) => {
              const Icon = option.Icon;
              return (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => setTheme(option.value)}
                  className="gap-2"
                >
                  <Icon className="size-4" />
                  <span className="flex-1">{option.label}</span>
                  {theme === option.value ? (
                    <Check className="size-3.5 text-accent" />
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-2 px-1 pt-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] rounded-[2px] border border-border px-[5px] py-0.5 text-text-subtle">Self-hosted</span>
          <span className="font-mono text-[11px] text-text-subtle">{workspaceName ?? "Prism"}</span>
        </div>
        <div className="mt-2 border-t border-border px-1 pt-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-haspopup="menu"
                className="flex w-full items-center gap-2.5 rounded-[2px] px-1 py-1 text-left transition-colors hover:bg-surface-hover"
              >
                <span
                  className="grid size-[26px] shrink-0 place-items-center rounded-full border border-border-strong bg-surface-raised font-mono text-[11px] font-semibold text-text"
                  aria-hidden="true"
                >
                  {getInitials(session?.user?.name ?? "Prism")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium leading-[1.2]">
                    {session?.user?.name ?? "Account"}
                  </span>
                  <span className="block truncate text-[11px] leading-[1.3] text-text-subtle">
                    {session?.user?.email ?? ""}
                  </span>
                </span>
                <I.IconChevronDown className="size-3.5 shrink-0 text-text-subtle" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={6} className="w-(--radix-dropdown-menu-trigger-width)">
              <DropdownMenuLabel className="font-normal">Account</DropdownMenuLabel>
              <Link to="/account/general">
                <DropdownMenuItem className="gap-2">
                  <User className="size-4" />
                  <span className="flex-1">Account</span>
                </DropdownMenuItem>
              </Link>
              <Link to="/account/security">
                <DropdownMenuItem className="gap-2">
                  <ShieldCheck className="size-4" />
                  <span className="flex-1">Security</span>
                </DropdownMenuItem>
              </Link>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="gap-2"
                onClick={async (e) => {
                  e.preventDefault();
                  await authClient.signOut();
                  window.location.href = "/auth/log-in";
                }}
              >
                <LogOut className="size-4 text-destructive" />
                <span className="flex-1">Sign out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </aside>
  );
}

const SOON_ANALYZE = ["Trends", "Funnels", "Retention", "Paths", "Cohorts"];
const SOON_DIAGNOSE = ["Errors", "Performance", "Replays", "Logs"];
const SOON_SHIP = ["Feature flags", "Experiments", "Surveys"];

const SOON_ICONS: Record<string, React.ReactNode> = {
  Trends: <I.IconTrend />, Funnels: <I.IconFunnel />, Retention: <I.IconRetention />,
  Paths: <I.IconPaths />, Cohorts: <I.IconCohort />,
  Errors: <I.IconAlert />, Performance: <I.IconGauge />, Replays: <I.IconReplay />,
  Logs: <I.IconLog />, "Feature flags": <I.IconFlag />, Experiments: <I.IconFlask />,
  Surveys: <I.IconSurvey />,
};
