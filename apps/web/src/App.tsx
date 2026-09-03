import { authClient } from "@/lib/authClient";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
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
	WorkspaceLanding,
	WorkspaceScope,
} from "./components/workspace/workspace-scope";
import { clearPersistedCache, client, getPersistKey } from "./lib/queryClient";

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
const EventDetail = lazy(() =>
	import("./routes/projects/project/event-detail").then((m) => ({
		default: m.EventDetail,
	})),
);
const ProjectWebAnalytics = lazy(() =>
	import("./routes/projects/project/web-analytics").then((m) => ({
		default: m.ProjectWebAnalytics,
	})),
);
const ProjectMobileAnalytics = lazy(() =>
	import("./routes/projects/project/mobile-analytics").then((m) => ({
		default: m.ProjectMobileAnalytics,
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
const PersonPresentationStack = lazy(() =>
	import("./routes/projects/project/person").then((m) => ({
		default: m.PersonPresentationStack,
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
const SourceDetailDialog = lazy(() =>
	import("./components/sources/detail/dialog").then((m) => ({
		default: m.SourceDetailDialog,
	})),
);
const ProjectErrors = lazy(() =>
	import("./routes/projects/project/errors").then((m) => ({
		default: m.ProjectErrors,
	})),
);

/**
 * /sources/:seg is ambiguous on purpose: a known type word (web / mobile /
 * server) renders the type Sources page, anything else (a src_* id) renders
 * the source detail as a dialog overlay on top of the list (same pattern as
 * errors/:issueId → Sheet). The list stays mounted underneath via
 * ProjectSources; closing the dialog navigates deterministically to the list
 * base (never history -1).
 */
function SourcesDispatch() {
	const { seg } = useParams();
	const isSource = seg !== undefined && !SOURCE_TYPE_WORDS.includes(seg);
	if (isSource) {
		return (
			<>
				<ProjectSources />
				<SourceDetailDialog />
			</>
		);
	}
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
					<Route index element={<WorkspaceLanding />} />
					{/* Legacy workspace dashboard URL. Workspace-level analytics no
					    longer has a dedicated page. */}
					<Route path="overview" element={<WorkspaceLanding />} />
					<Route path="members" element={<MembersPage />} />
					<Route path="settings" element={<WorkspaceSettingsLayout />}>
						<Route path="" element={<Navigate to="general" replace />} />
						<Route path="general" element={<WorkspaceSettingsGeneral />} />
					</Route>
					<Route path="projects">
						<Route path="" element={<Projects />} />
						<Route path=":slug" element={<ProjectLayout />}>
							<Route path="" element={<ProjectSummary />} />
							<Route path="events" element={<ProjectEvents />}>
								<Route path=":eventId" element={<EventDetail />} />
							</Route>
							<Route path="web-analytics" element={<ProjectWebAnalytics />} />
							<Route
								path="mobile-analytics"
								element={<ProjectMobileAnalytics />}
							/>
							<Route path="realtime" element={<ProjectRealtime />} />
							<Route path="people" element={<ProjectPeople />}>
								<Route path=":personId/*" element={<PersonPresentationStack />} />
							</Route>
							<Route path="errors/*" element={<ProjectErrors />} />
							<Route path="sources" element={<Navigate to="web" replace />} />
							<Route path="sources/:type/:tab" element={<ProjectSources />}>
								<Route path=":sourceId" element={<SourceDetailDialog />} />
							</Route>
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
function QueryPersistor() {
	const { data: sessionData } = authClient.useSession();
	const userId = (sessionData?.user as { id?: string } | undefined)?.id ?? null;
	const prevUserIdRef = React.useRef<string | null | undefined>(undefined);

	React.useEffect(() => {
		// F7: user-scoped persistence — clear previous user's cache on account switch / sign-out.
		const prev = prevUserIdRef.current;
		if (prev !== undefined && prev !== userId) {
			if (prev) {
				clearPersistedCache(getPersistKey(prev));
			}
			// Also remove legacy anon key once per session
			clearPersistedCache("prism-query-cache");
			if (!userId) {
				// Signed out — clear in-memory too (prevents flash of previous account's projects)
				client.clear();
				clearPersistedCache();
			}
		}
		prevUserIdRef.current = userId;

		// Set up persistence for this user. persistQueryClient is idempotent per key;
		// re-calling with same key is a no-op, with new key it hydrates that user's snapshot.
		void persistQueryClient({
			queryClient: client,
			persister: createSyncStoragePersister({
				key: getPersistKey(userId),
				storage: window.localStorage,
			}),
			maxAge: 1000 * 60 * 60 * 24,
			dehydrateOptions: {
				shouldDehydrateQuery: (query) => {
					const key = query.queryKey[0];
					return (
						typeof key === "string" &&
						["projects", "project", "sources", "source"].includes(key)
					);
				},
			},
		});
	}, [userId]);

	return null;
}

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
		<>
			<QueryPersistor />
			<RouterProvider router={router} />
		</>
	);
}
