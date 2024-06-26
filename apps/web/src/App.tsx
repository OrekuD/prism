import React from "react";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
  RouterProvider,
  Navigate,
} from "react-router-dom";
import RootLayout from "./components/layout/rootLayout";
import Index from "./routes/index";
import SignIn from "./routes/auth/log-in";
import CreateAccount from "./routes/auth/create-account";
import Apps from "./routes/apps";
import NewApp from "./routes/apps/new";
import AppLayout from "./components/layout/appLayout";
import AppSummary from "./routes/apps/app/summary";
import AppEvents from "./routes/apps/app/events";
import AppSettings from "./routes/apps/app/settings";
import ProfileSettings from "./routes/profile/settings";
import ProfileLayout from "./components/layout/profileLayout";
import useAuthenticationStore from "./store/authenticationStore";

const defaultRouter = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<RootLayout />}>
      <Route path="" element={<Index />} />
      <Route path="auth">
        <Route path="log-in" element={<SignIn />} />
        <Route path="create-account" element={<CreateAccount />} />
      </Route>
      <Route path="*" element={<Navigate to="/auth/log-in" />} />
    </Route>,
  ),
);

const authenticatedRouter = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<RootLayout />}>
      <Route path="" element={<Index />} />
      <Route path="apps">
        <Route path="" element={<Apps />} />
        <Route path="new" element={<NewApp />} />
        <Route path=":id" element={<AppLayout />}>
          <Route path="summary" element={<AppSummary />} />
          <Route path="events" element={<AppEvents />} />
          <Route path="settings" element={<AppSettings />} />
        </Route>
      </Route>
      <Route path="profile" element={<ProfileLayout />}>
        <Route path="settings" element={<ProfileSettings />} />
      </Route>
      <Route path="*" element={<Navigate to="/apps" />} />
    </Route>,
  ),
);

export default function App() {
  const { isAuthenticated } = useAuthenticationStore();

  return (
    <RouterProvider
      router={isAuthenticated ? authenticatedRouter : defaultRouter}
    />
  );
}
