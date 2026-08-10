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
import { Index } from "./routes/index";
import { LogIn } from "./routes/auth/log-in";
import { CreateAccount } from "./routes/auth/create-account";
import { Projects } from "./routes/projects";
import { NewProject } from "./routes/projects/new";
import { ProjectLayout } from "./components/layout/project-layout";
import { ProjectSummary } from "./routes/projects/project/summary";
import { ProjectEvents } from "./routes/projects/project/events";
import { AccountGeneral } from "./routes/profile/general";
import { AccountSecurity } from "./routes/profile/security";
import { AccountAuthentication } from "./routes/profile/authentication";
import { AccountTeams } from "./routes/profile/teams";
import { AccountLayout } from "./components/layout/account-layout";
import { ForgotPassword } from "./routes/auth/forgot-password";
import { ResetPassword } from "./routes/auth/reset-password";
import { useRefreshUser } from "./hooks/useRefreshUser";
import { JoinTeam } from "./routes/teams/join-team";
import { ProjectSettingsLayout } from "./components/layout/project-settings-layout";
import { ProjectSettingsApiKeys } from "./routes/projects/project/settings/api-keys";
import { ProjectSettingsGeneral } from "./routes/projects/project/settings/general";
import { ProjectRealtime } from "./routes/projects/project/realtime";
import { Skeleton } from "./components/ui/skeleton";
import { Gallery } from "./routes/gallery";
import { Onboarding } from "./routes/onboarding";
import { NotFound } from "./routes/not-found";

const defaultRouter = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<PublicLayout />}>
      <Route path="" element={<Index />} />
      <Route path="join" element={<JoinTeam />} />
      <Route path="auth">
        <Route path="log-in" element={<LogIn />} />
        <Route path="create-account" element={<CreateAccount />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password" element={<ResetPassword />} />
      </Route>
      {import.meta.env.DEV ? (
        <Route path="__gallery" element={<Gallery />} />
      ) : null}
      <Route path="*" element={<NotFound />} />
    </Route>,
  ),
);

const authenticatedRouter = createBrowserRouter(
  createRoutesFromElements(
    <>
      {/* The landing page always renders with the public layout and nav,
          even when signed in. Equal-score "/" routes resolve in
          declaration order, so the landing wins at "/" and the product
          shell handles every other path. */}
      <Route path="/" element={<PublicLayout />}>
        <Route path="" element={<Index />} />
      </Route>
      <Route path="/" element={<RootLayout />}>
        <Route path="join" element={<JoinTeam />} />
        <Route path="onboarding" element={<Onboarding />} />
        <Route path="projects">
        <Route path="" element={<Projects />} />
        <Route path="new" element={<NewProject />} />
        <Route path=":slug" element={<ProjectLayout />}>
          <Route path="" element={<ProjectSummary />} />
          <Route path="events" element={<ProjectEvents />} />
          <Route path="realtime" element={<ProjectRealtime />} />
          <Route path="settings" element={<ProjectSettingsLayout />}>
            <Route path="" element={<Navigate to="general" />} />
            <Route path="general" element={<ProjectSettingsGeneral />} />
            <Route path="api-keys" element={<ProjectSettingsApiKeys />} />
          </Route>
        </Route>
      </Route>
      <Route path="account" element={<AccountLayout />}>
        <Route path="" element={<Navigate to="general" />} />
        <Route path="general" element={<AccountGeneral />} />
        <Route path="security" element={<AccountSecurity />} />
        <Route path="authentication" element={<AccountAuthentication />} />
        <Route path="teams" element={<AccountTeams />} />
      </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
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

  return (
    <RouterProvider
      router={sessionData?.session ? authenticatedRouter : defaultRouter}
    />
  );
}
