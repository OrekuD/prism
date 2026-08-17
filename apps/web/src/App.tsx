import { Loader2 } from "lucide-react";
import React from "react";
import { authClient } from "@/lib/authClient";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
  RouterProvider,
  Navigate,
} from "react-router-dom";
import { RootLayout } from "./components/layout/root-layout";
import { PublicLayout } from "./components/layout/public-layout";
import { lazy } from "react";

/**
 * Route-level code splitting: the dashboard subtree (charts, mapbox,
 * radix composites) loads only when a dashboard route is entered, keeping
 * the public landing/auth entry small (LCP budget, task-5 section 7).
 */
const Projects = lazy(() =>
  import("./routes/projects").then((m) => ({ default: m.Projects })),
);
const NewProject = lazy(() =>
  import("./routes/projects/new").then((m) => ({ default: m.NewProject })),
);
const ProjectLayout = lazy(() =>
  import("./components/layout/project-layout").then((m) => ({
    default: m.ProjectLayout,
  })),
);
const ProjectSummary = lazy(() =>
  import("./routes/projects/project/summary").then((m) => ({
    default: m.ProjectSummary,
  })),
);
const ProjectEvents = lazy(() =>
  import("./routes/projects/project/events").then((m) => ({
    default: m.ProjectEvents,
  })),
);
const ProjectRealtime = lazy(() =>
  import("./routes/projects/project/realtime").then((m) => ({
    default: m.ProjectRealtime,
  })),
);
const ProjectPeople = lazy(() =>
  import("./routes/projects/project/people").then((m) => ({
    default: m.ProjectPeople,
  })),
);
const PersonDetail = lazy(() =>
  import("./routes/projects/project/person").then((m) => ({
    default: m.PersonDetail,
  })),
);
const ProjectSettingsLayout = lazy(() =>
  import("./components/layout/project-settings-layout").then((m) => ({
    default: m.ProjectSettingsLayout,
  })),
);
const ProjectSettingsGeneral = lazy(() =>
  import("./routes/projects/project/settings/general").then((m) => ({
    default: m.ProjectSettingsGeneral,
  })),
);
const AccountGeneral = lazy(() =>
  import("./routes/profile/general").then((m) => ({
    default: m.AccountGeneral,
  })),
);
const AccountSecurity = lazy(() =>
  import("./routes/profile/security").then((m) => ({
    default: m.AccountSecurity,
  })),
);
const AccountAuthentication = lazy(() =>
  import("./routes/profile/authentication").then((m) => ({
    default: m.AccountAuthentication,
  })),
);
const AccountWorkspaces = lazy(() =>
  import("./routes/profile/workspace").then((m) => ({
    default: m.AccountWorkspaces,
  })),
);
const ProjectSources = lazy(() =>
  import("./routes/projects/project/sources").then((m) => ({
    default: m.ProjectSources,
  })),
);
const SourceDetail = lazy(() =>
  import("./routes/projects/project/sources/source-detail").then((m) => ({
    default: m.SourceDetail,
  })),
);
const AccountLayout = lazy(() =>
  import("./components/layout/account-layout").then((m) => ({
    default: m.AccountLayout,
  })),
);
const Onboarding = lazy(() =>
  import("./routes/onboarding").then((m) => ({ default: m.Onboarding })),
);
const Overview = lazy(() =>
  import("./routes/overview").then((m) => ({ default: m.Overview })),
);

import { Index } from "./routes/index";
import { LogIn } from "./routes/auth/log-in";
import { CreateAccount } from "./routes/auth/create-account";
import { ForgotPassword } from "./routes/auth/forgot-password";
import { ResetPassword } from "./routes/auth/reset-password";
import { useRefreshUser } from "./hooks/useRefreshUser";
import { Skeleton } from "./components/ui/skeleton";
import { Gallery } from "./routes/gallery";
import { NotFound } from "./routes/not-found";

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      {/* Public chrome: landing, auth pages, invite joins, and the dev
          gallery. The landing stays at "/" even when signed in; the
          product shell below handles every other path. */}
      <Route path="/" element={<PublicLayout />}>
        <Route path="" element={<Index />} />
        {/* Anonymous first boot (self-hosted): renders the OwnerSetup
            branch of the onboarding page. Signed-in visitors are
            redirected to the product shell by the page itself. */}
        <Route path="setup" element={<Onboarding />} />
        <Route path="auth">
          <Route path="log-in" element={<LogIn />} />
          <Route path="create-account" element={<CreateAccount />} />
          <Route path="forgot-password" element={<ForgotPassword />} />
          <Route path="reset-password" element={<ResetPassword />} />
        </Route>
        {import.meta.env.DEV ? (
          <Route path="__gallery" element={<Gallery />} />
        ) : null}
      </Route>
      {/* Product shell. Signed-in only: RootLayout redirects signed-out
          visitors to the sign-in page, so protected paths can never
          404 or flash — the router is swapped never, session changes
          only re-render. */}
      <Route path="/" element={<RootLayout />}>
        <Route path="onboarding" element={<Onboarding />} />
        <Route path="overview" element={<Overview />} />
        <Route path="projects">
          <Route path="" element={<Projects />} />
          <Route path="new" element={<NewProject />} />
          <Route path=":slug" element={<ProjectLayout />}>
            <Route path="" element={<ProjectSummary />} />
            <Route path="events" element={<ProjectEvents />} />
            <Route path="realtime" element={<ProjectRealtime />} />
            <Route path="people" element={<ProjectPeople />} />
            <Route path="people/:personId" element={<PersonDetail />} />
            <Route path="sources" element={<ProjectSources />} />
            <Route path="sources/:sourceId" element={<SourceDetail />} />
            <Route path="settings" element={<ProjectSettingsLayout />}>
              <Route path="" element={<Navigate to="general" />} />
              <Route path="general" element={<ProjectSettingsGeneral />} />
            </Route>
          </Route>
        </Route>
        <Route path="account" element={<AccountLayout />}>
          <Route path="" element={<Navigate to="general" />} />
          <Route path="general" element={<AccountGeneral />} />
          <Route path="security" element={<AccountSecurity />} />
          <Route path="authentication" element={<AccountAuthentication />} />
          <Route path="workspace" element={<AccountWorkspaces />} />
        </Route>
      </Route>
      {/* Everyone gets the full public 404 experience. */}
      <Route
        path="*"
        element={
          <PublicLayout>
            <NotFound />
          </PublicLayout>
        }
      />
    </>,
  ),
);

/**
 * Session-driven routing. While the initial session check is pending, a
 * loading state is shown so protected routes never flash or redirect
 * incorrectly.
 */
export function App() {
  const { data: sessionData, isPending } = authClient.useSession();

  useRefreshUser(Boolean(sessionData?.session));

  if (isPending) {
    return (
      <div className="grid h-screen w-full place-items-center">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  return <RouterProvider router={router} />;
}
