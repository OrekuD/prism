import type React from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import { authClient } from "@/lib/authClient";
import { useActiveWorkspace, useWorkspaces } from "@/lib/workspace";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";
import { getInitials } from "@/utils/getInitials";
import * as I from "./icons";

const VITE_DOCS_URL: string =
  import.meta.env.VITE_DOCS_URL ?? "http://localhost:3000";

type NavItem = {
  to: string;
  label: string;
  icon: React.ReactNode;
  /** Match the nav item only on this exact url-bearing path. */
  end?: boolean;
};

function Active (props: { to: string; label: string; icon: React.ReactNode; className?: string; end?: boolean }) {
  return (
    <NavLink
      to={props.to}
      end={props.end}
      className={({ isActive }) =>
        cn("sb-link", isActive && "active", props.className)
      }
    >
      {props.icon}
      {props.label}
    </NavLink>
  );
}

export function Sidebar() {
  const { pathname } = useLocation();
  const { theme, setTheme } = useTheme();
  const { data: session } = authClient.useSession();
  const { data: activeWorkspace } = useActiveWorkspace();
  const projectsQuery = useProjectsQuery();

  // Currently open project (when inside /projects/:slug…).
  const slug = pathname.split("/")[2];
  const project = projectsQuery.data?.find((entry) => entry.slug === slug);
  const workspaceName = (activeWorkspace as { name?: string } | null)?.name;

  const isDark = theme === "dark" || theme === "system";

  return (
    <aside className="sidebar" id="sidebar" aria-label="Workspace navigation">
      <div className="sb-brand">
        <span className="brand-mark" aria-hidden="true">
          <I.BrandMark />
        </span>
        <span className="brand-name">Prism</span>
      </div>

      <nav className="sb-groups">
        <div className="sb-group">
          <div className="sb-label">Workspace</div>
          <Active to="/overview" label="Workspace overview" icon={<I.IconGrid />} end />
          <Active to="/projects" label="Projects" icon={<I.IconFolder />} />
          <Active to="/account/workspace" label="Members" icon={<I.IconUsers />} />
        </div>

        <div className="sb-group">
          <div className="sb-label">Project</div>
          <Link to="/projects" className="ws-switch sb-inline" aria-label="Switch project">
            <I.IconFolder />
            <span className="ws-name">{project?.name ?? workspaceName ?? "Select a project"}</span>
            <I.IconChevronDown />
          </Link>
          {project ? (
            <Active
              to={`/projects/${project.slug}`}
              end
              label="Overview"
              icon={<I.IconChart />}
            />
          ) : null}
        </div>

        <div className="sb-group">
          <div className="sb-label">Data</div>
          {slug ? (
            <>
              <Active to={`/projects/${slug}/events`} label="Events" icon={<I.IconBolt />} />
              <Active to={`/projects/${slug}/people`} label="People" icon={<I.IconPerson />} />
              <Active to={`/projects/${slug}/realtime`} label="Live" icon={<I.IconGlobe />} />
            </>
          ) : null}
        </div>

        <div className="sb-group">
          <div className="sb-label">Analyze <span className="soon-tag">soon</span></div>
          {SOON_ANALYZE.map((item) => <SoonLink key={item} label={item} />)}
        </div>
        <div className="sb-group">
          <div className="sb-label">Diagnose <span className="soon-tag">soon</span></div>
          {SOON_DIAGNOSE.map((item) => <SoonLink key={item} label={item} />)}
        </div>
        <div className="sb-group">
          <div className="sb-label">Ship <span className="soon-tag">soon</span></div>
          {SOON_SHIP.map((item) => <SoonLink key={item} label={item} />)}
        </div>

        <div className="sb-group">
          <div className="sb-label">Configure</div>
          {slug ? (
            <>
              <Active to={`/projects/${slug}/sources`} label="Sources" icon={<I.IconGlobe />} />
              <Active to={`/projects/${slug}/settings`} label="Settings" icon={<I.IconSettings />} />
            </>
          ) : null}
        </div>
      </nav>

      <div className="sb-foot">
        <a className="sb-link" href={VITE_DOCS_URL} target="_blank" rel="noreferrer">
          <I.IconDoc />Docs
        </a>
        <button
          className="sb-link"
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          <I.IconMoon />
          <span style={{ flex: 1, textAlign: "left" }}>Theme</span>
          <span className="theme-val" style={{ font: "500 11px/1 var(--font-mono)", color: "var(--text-subtle)" }}>
            {isDark ? "Dark" : "Light"}
          </span>
        </button>
        <div className="sb-inst">
          <span className="inst-label">Self-hosted</span>
          <span className="inst-name">{workspaceName ?? "Prism"}</span>
        </div>
        <div className="sb-acct">
          <Link to="/account/general" aria-label="Account settings">
            <span className="avatar" aria-hidden="true">
              {getInitials(session?.user?.name ?? "Prism")}
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="acct-nm">{session?.user?.name ?? "Account"}</span>
              <span className="acct-em">{session?.user?.email ?? ""}</span>
            </span>
          </Link>
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

function SoonLink({ label }: { label: string }) {
  return (
    <span
      className="sb-link soon"
      title={`${label} — coming soon`}
    >
      {SOON_ICONS[label]}
      {label}
    </span>
  );
}
