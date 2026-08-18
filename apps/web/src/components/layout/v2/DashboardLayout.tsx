import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";

/**
 * v2 dashboard shell (port of analytics-dashboard-v2.html): persistent
 * 240px sidebar + sticky toolbar + centered content column. On viewports
 * below 1024px the sidebar becomes an off-canvas drawer opened by the
 * toolbar menu button, with a scrim overlay — see dashboard-v2.css.
 */
export function DashboardLayout() {
  const [navOpen, setNavOpen] = React.useState(false);
  const { pathname } = useLocation();

  // Close the mobile drawer on navigation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: drawer closes on any route change
  React.useEffect(() => setNavOpen(false), [pathname]);

  return (
    <div className="shell">
      <div className={navOpen ? "sidebar open" : "sidebar"}>
        <Sidebar />
      </div>
      <button
        type="button"
        className={navOpen ? "scrim on" : "scrim"}
        onClick={() => setNavOpen(false)}
        aria-label="Close navigation"
        tabIndex={-1}
      />
      <div className="main-col">
        <Toolbar onMenu={() => setNavOpen(true)} />
        <div className="content">
          <main className="view">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
