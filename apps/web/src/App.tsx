import React from "react";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
  RouterProvider,
  Navigate,
} from "react-router-dom";
import { RootLayout } from "./components/layout/rootLayout";
import { Index } from "./routes/index";
import { LogIn } from "./routes/auth/log-in";
import { CreateAccount } from "./routes/auth/create-account";
import { Apps } from "./routes/apps";
import { NewApp } from "./routes/apps/new";
import { AppLayout } from "./components/layout/appLayout";
import { AppSummary } from "./routes/apps/app/summary";
import { AppEvents } from "./routes/apps/app/events";
import { AppSettings } from "./routes/apps/app/settings";
import { AccountGeneral } from "./routes/profile/general";
import { AccountSecurity } from "./routes/profile/security";
import { AccountAuthentication } from "./routes/profile/authentication";
import { AccountTeams } from "./routes/profile/teams";
import { AccountLayout } from "./components/layout/accountLayout";
import { ForgotPassword } from "./routes/auth/forgot-password";
import { ResetPassword } from "./routes/auth/reset-password";
import { useAuthenticationStore } from "./store/authenticationStore";
import { useRefreshUser } from "./hooks/useRefreshUser";
import { JoinTeam } from "./routes/teams/join-team";
import { usePrism } from "@prism/react";

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
      <Route path="apps">
        <Route path="" element={<Apps />} />
        <Route path="new" element={<NewApp />} />
        <Route path=":id" element={<AppLayout />}>
          <Route path="" element={<AppSummary />} />
          <Route path="events" element={<AppEvents />} />
          <Route path="settings" element={<AppSettings />} />
        </Route>
      </Route>
      <Route path="account" element={<AccountLayout />}>
        <Route path="" element={<AccountGeneral />} />
        <Route path="security" element={<AccountSecurity />} />
        <Route path="authentication" element={<AccountAuthentication />} />
        <Route path="teams" element={<AccountTeams />} />
      </Route>
      <Route path="*" element={<Navigate to="/apps" />} />
    </Route>,
  ),
);

export default function App() {
  const authenticationStore = useAuthenticationStore();
  const { message } = usePrism();

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
