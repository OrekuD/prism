import { authClient } from "@/lib/authClient";
import { Loader2 } from "lucide-react";
import React from "react";
import { lazy } from "react";
import {
	Navigate,
	Route,
	RouterProvider,
	createBrowserRouter,
	createRoutesFromElements,
	useParams,
} from "react-router-dom";
import { PublicLayout } from "./components/layout/public-layout";
import { RootLayout } from "./components/layout/root-layout";
import {
	RedirectToProjectWs,
	RedirectToWs,
	WorkspaceHome,
	WorkspaceScope,
} from "./components/workspace/workspace-scope";

/**
 * Route-level code splitting: the dashboard subtree (charts, mapbox,
 * radix composites) loads only when a dashboard route is entered, keeping
 * the public landing/auth entry small (LCP budget, task-5 section 7).
 */
const Projects = lazy(() =>
	import("./routes/projects").then((m) => ({ default: m.Projects })),
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
	import("./routes/account/general").then((m) => ({
		default: m.AccountGeneral,
	})),
);
const AccountSecurity = lazy(() =>
	import("./routes/account/security").then((m) => ({
		default: m.AccountSecurity,
	})),
);
const AccountAuthentication = lazy(() =>
	import("./routes/account/authentication").then((m) => ({
		default: m.AccountAuthentication,
	})),
);
const AccountWorkspaces = lazy(() =>
	import("./routes/account/workspace").then((m) => ({
		default: m.AccountWorkspaces,
	})),
);
const ProjectSources = lazy(() =>
	import("./routes/projects/project/sources/index").then((m) => ({
		default: m.ProjectSources,
	})),
);
const SourceDetail = lazy(() =>
	import("./routes/projects/project/sources/source-detail").then((m) => ({
		default: m.SourceDetail,
	})),
);
const ProjectErrors = lazy(() =>
	import("./routes/projects/project/errors").then((m) => ({
		default: m.ProjectErrors,
	})),
);
const IssueDetail = lazy(() =>
	import("./routes/projects/project/issue-detail").then((m) => ({
		default: m.IssueDetail,
	})),
);

/**
 * /sources/:seg is ambiguous on purpose: a known type word (web / mobile /
 * server) renders the type Sources page, anything else (a src_* id) renders
 * the dedicated source page.
 */
function SourcesDispatch() {
	const { seg } = useParams();
	if (seg && !SOURCE_TYPE_WORDS.includes(seg)) return <SourceDetail />;
	return <ProjectSources />;
}
const AccountLayout = lazy(() =>
	import("./components/layout/account-layout").then((m) => ({
		default: m.AccountLayout,
	})),
);
const Onboarding = lazy(() =>
	import("./routes/onboarding").then((m) => ({ default: m.Onboarding })),
);
const Overview = lazy(() =>
	import("./routes/workspace/overview").then((m) => ({ default: m.Overview })),
);
const MembersPage = lazy(() =>
	import("./routes/workspace/members").then((m) => ({
		default: m.MembersPage,
	})),
);
const WorkspaceSettingsLayout = lazy(() =>
	import("./components/layout/workspace-settings-layout").then((m) => ({
		default: m.WorkspaceSettingsLayout,
	})),
);
const WorkspaceSettingsGeneral = lazy(() =>
	import("./routes/workspace/settings/general").then((m) => ({
		default: m.WorkspaceSettingsGeneral,
	})),
);

import { Skeleton } from "./components/ui/skeleton";
import { useRefreshUser } from "./hooks/useRefreshUser";
import { SOURCE_TYPE_WORDS } from "./lib/sources";
import { CreateAccount } from "./routes/auth/create-account";
import { ForgotPassword } from "./routes/auth/forgot-password";
import { LogIn } from "./routes/auth/log-in";
import { ResetPassword } from "./routes/auth/reset-password";
import { Gallery } from "./routes/gallery";
import { Index } from "./routes/index";
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
				{/* Legacy vanity home (and the login redirect target) → scoped. */}
				<Route path="overview" element={<WorkspaceHome />} />
				{["projects", "members"].map((seg) => (
					<Route
						key={seg}
						path={seg}
						element={<RedirectToWs to={`/${seg}`} />}
					/>
				))}
				<Route path="settings" element={<RedirectToWs to="/settings" />} />
				<Route
					path="members/settings"
					element={<RedirectToWs to="/settings" />}
				/>
				{/* Legacy project deep links → scoped. */}
				<Route path="projects/:slug/*" element={<RedirectToProjectWs />} />
				<Route path="members/:slug/*" element={<RedirectToProjectWs />} />

				{/* Workspace-scoped product routes. */}
				<Route path="workspace/:wrkSlug" element={<WorkspaceScope />}>
					<Route path="overview" element={<Overview />} />
					<Route path="members" element={<MembersPage />} />
					<Route path="settings" element={<WorkspaceSettingsLayout />}>
						<Route path="" element={<Navigate to="general" replace />} />
						<Route path="general" element={<WorkspaceSettingsGeneral />} />
					</Route>
					<Route path="projects">
						<Route path="" element={<Projects />} />
						<Route path=":slug" element={<ProjectLayout />}>
							<Route path="" element={<ProjectSummary />} />
							<Route path="events" element={<ProjectEvents />} />
							<Route path="realtime" element={<ProjectRealtime />} />
							<Route path="people" element={<ProjectPeople />} />
							<Route path="people/:personId" element={<PersonDetail />} />
							<Route path="errors" element={<ProjectErrors />}>
								<Route path=":issueId" element={<IssueDetail />} />
							</Route>
							<Route path="sources" element={<Navigate to="web" replace />} />
							<Route path="sources/:type/:tab" element={<ProjectSources />} />
							<Route path="sources/:seg" element={<SourcesDispatch />} />
							<Route path="settings" element={<ProjectSettingsLayout />}>
								<Route path="" element={<Navigate to="general" />} />
								<Route path="general" element={<ProjectSettingsGeneral />} />
							</Route>
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
