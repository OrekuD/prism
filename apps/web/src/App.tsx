import React from "react";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
  RouterProvider,
  Navigate,
} from "react-router-dom";
import { RootLayout } from "./components/layout/root-layout";
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
import { useAuthenticationStore } from "./store/authenticationStore";
import { useRefreshUser } from "./hooks/useRefreshUser";
import { JoinTeam } from "./routes/teams/join-team";
import { usePrism } from "@prism/react";
import { ProjectSettingsLayout } from "./components/layout/project-settings-layout";
import { ProjectSettingsApiKeys } from "./routes/projects/project/settings/api-keys";
import { ProjectSettingsGeneral } from "./routes/projects/project/settings/general";

// try sqlite in memory as redis-like db

const defaultRouter = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<RootLayout />}>
      <Route path="" element={<Index />} />
      <Route path="join" element={<JoinTeam />} />
      <Route path="auth">
        <Route path="log-in" element={<LogIn />} />
        <Route path="create-account" element={<CreateAccount />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password" element={<ResetPassword />} />
      </Route>
      <Route path="*" element={<Navigate to="/auth/log-in" />} />
    </Route>,
  ),
);

const authenticatedRouter = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<RootLayout />}>
      <Route path="" element={<Index />} />
      <Route path="join" element={<JoinTeam />} />
      <Route path="projects">
        <Route path="" element={<Projects />} />
        <Route path="new" element={<NewProject />} />
        <Route path=":slug" element={<ProjectLayout />}>
          <Route path="" element={<ProjectSummary />} />
          <Route path="events" element={<ProjectEvents />} />
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
      <Route path="*" element={<Navigate to="/projects" />} />
    </Route>,
  ),
);

export function App() {
  const authenticationStore = useAuthenticationStore();
  const { logEvent, logCustomEvent } = usePrism();

  useRefreshUser();

  return (
    <RouterProvider
      router={
        authenticationStore.isAuthenticated
          ? authenticatedRouter
          : defaultRouter
      }
    />
  );
}
