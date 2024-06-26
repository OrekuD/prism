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
import Projects from "./routes/projects";
import NewProject from "./routes/projects/new";
import ProjectLayout from "./components/layout/projectLayout";
import ProjectSummary from "./routes/projects/project/events";
import ProjectEvents from "./routes/projects/project/summary";
import ProfileSettings from "./routes/profile/settings";
import { ProfileLayout } from "./components/layout/profileLayout";
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
      <Route path="projects">
        <Route path="" element={<Projects />} />
        <Route path="new" element={<NewProject />} />
        <Route path=":id" element={<ProjectLayout />}>
          <Route path="summary" element={<ProjectSummary />} />
          <Route path="events" element={<ProjectEvents />} />
        </Route>
      </Route>
      <Route path="profile" element={<ProfileLayout />}>
        <Route path="settings" element={<ProfileSettings />} />
      </Route>
      <Route path="*" element={<Navigate to="/projects" />} />
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
