import { Frame } from "@/components/public/frame";
import { PageHeader } from "@/components/public/page-header";
import { MetricCard } from "@/components/public/metric-card";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	PLATFORM_LABELS,
	SOURCE_TABS,
	SOURCE_TYPES,
	SOURCE_TYPE_PLATFORMS,
	SOURCE_TYPE_WORDS,
	formatCount,
	maskKey,
	sdkSnippet,
	sourceSnippetPlatform,
	sourceTypeLabel,
	timeAgo,
} from "@/lib/sources";
import { cn } from "@/lib/utils";
import { useActiveMember } from "@/lib/workspace";
import { CREATABLE_PLATFORMS } from "@/lib/workspace";
import {
	useCreateKeyMutation,
	useCreateSourceMutation,
	useRevokeKeyMutation,
} from "@/network/mutations/useSourceMutations";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import {
	type SourceKeyResource,
	type SourceResource,
	useSourcesQuery,
} from "@/network/queries/useSourcesQuery";
import {
	Ban,
	Globe,
	KeyRound,
	Loader2,
	Plus,
	Server,
	Smartphone,
} from "lucide-react";
import React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

const TAB_WORDS = SOURCE_TABS.map((entry) => entry.tab);

const INSTALL_CMDS: Record<string, string> = {
	web: "npm install @prism-analytics/browser",
	"react-native": "npm install @prism-analytics/react-native",
	server: "npm install @prism-analytics/core",
};

function TypeIcon({ type, className }: { type: string; className?: string }) {
	const cls = className ?? "size-4";
	if (type === "web") return <Globe className={cls} aria-hidden="true" />;
	if (type === "mobile")
		return <Smartphone className={cls} aria-hidden="true" />;
	return <Server className={cls} aria-hidden="true" />;
}

// ---------------------------------------------------------------- create source

function CreateSourceDialog({
	slug,
	initialPlatform = "web",
}: {
	slug: string;
	initialPlatform?: string;
}) {
	const [open, setOpen] = React.useState(false);
	const [name, setName] = React.useState("");
	const [platform, setPlatform] = React.useState<string>(initialPlatform);
	const createMutation = useCreateSourceMutation(slug);
	const admin = useActiveMember();

	const canManage =
		admin?.data?.role === "owner" || admin?.data?.role === "admin";

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		if (!name.trim()) return;
		await createMutation.mutateAsync({ name: name.trim(), platform });
		setOpen(false);
		setName("");
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					disabled={!canManage}
					title={canManage ? undefined : "Members cannot create sources"}
				>
					<Plus className="size-4" /> New source
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create source</DialogTitle>
					<DialogDescription>
						A source is one installation that sends data to this project. Its
						initial ingestion key is created with it and shown once.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={onSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label>Name</Label>
						<Input
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="Marketing site"
						/>
					</div>
					<div className="space-y-2">
						<Label>Platform</Label>
						<Select value={platform} onValueChange={setPlatform}>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{CREATABLE_PLATFORMS.map((value) => (
									<SelectItem key={value} value={value}>
										{PLATFORM_LABELS[value]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button type="submit" disabled={createMutation.isPending}>
							{createMutation.isPending ? (
								<Loader2 className="size-4 animate-spin" aria-hidden="true" />
							) : null}
							Create
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// ----------------------------------------------------------------- create key

function CreateKeyButton({
	slug,
	sourceId,
}: {
	slug: string;
	sourceId: string;
}) {
	const [open, setOpen] = React.useState(false);
	const [name, setName] = React.useState("");
	const [shownKey, setShownKey] = React.useState<string | null>(null);
	const createKey = useCreateKeyMutation(slug);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size="sm">
					<Plus className="size-3.5" /> Create key
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create a new ingestion key</DialogTitle>
					<DialogDescription>
						The new key is shown once — store it before closing.
					</DialogDescription>
				</DialogHeader>
				{shownKey ? (
					<div className="space-y-3">
						<Label>New key (shown once)</Label>
						<div className="flex items-center gap-2">
							<code className="flex-1 break-all rounded border p-2 text-xs">
								{shownKey}
							</code>
							<CopyButton value={shownKey} />
						</div>
						<DialogFooter>
							<DialogClose asChild>
								<Button
									onClick={() => {
										setShownKey(null);
										setName("");
									}}
								>
									Done
								</Button>
							</DialogClose>
						</DialogFooter>
					</div>
				) : (
					<form
						className="space-y-4"
						onSubmit={async (event) => {
							event.preventDefault();
							if (!name.trim()) return;
							const result = await createKey.mutateAsync({
								sourceId,
								name: name.trim(),
							});
							setShownKey(result.value);
							setName("");
						}}
					>
						<div className="space-y-2">
							<Label>Key name</Label>
							<Input
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="2026 rotation"
							/>
						</div>
						<DialogFooter>
							<DialogClose asChild>
								<Button type="button" variant="outline">
									Cancel
								</Button>
							</DialogClose>
							<Button type="submit" disabled={createKey.isPending}>
								{createKey.isPending ? (
									<Loader2 className="size-4 animate-spin" aria-hidden="true" />
								) : null}
								Create key
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}

function RevokeKeyButton({
	slug,
	sourceId,
	keyId,
	name,
}: {
	slug: string;
	sourceId: string;
	keyId: string;
	name: string;
}) {
	const revokeKey = useRevokeKeyMutation(slug);

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Revoke ${name}`}
					title={`Revoke ${name}`}
				>
					<Ban className="size-3.5" />
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Revoke key “{name}”?</AlertDialogTitle>
					<AlertDialogDescription>
						Existing installs using this key stop sending. This can't be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={revokeKey.isPending}>
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction
						className="bg-danger text-white hover:bg-danger/90"
						disabled={revokeKey.isPending}
						onClick={async (event) => {
							event.preventDefault();
							await revokeKey.mutateAsync({ sourceId, keyId });
						}}
					>
						Revoke key
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

// -------------------------------------------------------------------- panels

function ConfiguredTag() {
	return (
		<span className="inline-flex h-6 items-center gap-1.5 rounded-[2px] border border-success/40 px-2.5 font-mono text-[11px] font-medium text-success">
			<span className="size-[7px] rounded-full bg-success" aria-hidden="true" />
			Configured
		</span>
	);
}

function SourceOverview({
	sources,
	type,
	wrkSlug,
	slug,
	canManage,
}: {
	sources: SourceResource[];
	type: string;
	wrkSlug: string;
	slug: string;
	canManage: boolean;
}) {
	const label = sourceTypeLabel(type);
	const repPlatform = sourceSnippetPlatform(type);
	const activeKeys = sources.flatMap((source) =>
		source.keys.filter((key) => key.status === "active"),
	);
	const configured = activeKeys.length > 0;
	const events = sources.reduce(
		(total, source) => total + (source.telemetry?.events ?? 0),
		0,
	);
	const lastAt = sources.reduce(
		(latest, source) => Math.max(latest, source.telemetry?.lastReceivedAt ?? 0),
		0,
	);
	const installCmd = INSTALL_CMDS[repPlatform] ?? "";

	return (
		<>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<MetricCard
					label="Status"
					caption={
						activeKeys.length === 1
							? "1 active key"
							: `${activeKeys.length} active keys`
					}
				>
					{configured ? (
						<ConfiguredTag />
					) : (
						<span className="font-mono text-[14px] text-text">
							Not configured
						</span>
					)}
				</MetricCard>
				<MetricCard label="SDK" caption="Installed platform">
					<span className="font-mono text-[20px] tracking-[-0.06em] text-text">
						{PLATFORM_LABELS[repPlatform] ?? repPlatform}
					</span>
				</MetricCard>
				<MetricCard label="Events" caption="All time">
					<span className="font-mono text-[23px] tracking-[-0.06em] text-text">
						{formatCount(events)}
					</span>
				</MetricCard>
				<MetricCard label="Last event" caption="Reported by the source SDK">
					<span className="font-mono text-[20px] tracking-[-0.06em] text-text">
						{timeAgo(lastAt)}
					</span>
				</MetricCard>
			</div>

			<Frame className="mt-[13px] px-4 py-1.5">
				{[
					[
						"Sources",
						sources.length === 1 ? "1 source" : `${sources.length} sources`,
					],
					["Install", installCmd],
					[
						"Key",
						configured
							? "Publishable / secret"
							: "Create a source to get a key",
					],
				].map(([k, v], index) => (
					<div
						key={k}
						className={cn(
							"flex items-center justify-between gap-3 py-2 text-[13px]",
							index > 0 && "border-t border-border",
						)}
					>
						<span className="text-text-muted">{k}</span>
						<span className="truncate font-mono text-[13px] text-text">
							{v}
						</span>
					</div>
				))}
			</Frame>

			{sources.length === 0 ? (
				<Frame className="mt-3 flex flex-wrap items-center justify-between gap-3 p-5">
					<p className="text-[13px] text-text-muted">
						No {label} source in this project yet — create one to get its key
						and SDK setup.
					</p>
					{canManage ? (
						<CreateSourceDialog slug={slug} initialPlatform={repPlatform} />
					) : null}
				</Frame>
			) : null}

			{sources.length > 1 ? (
				<div className="mt-3 flex items-center gap-2 text-[12px] text-text-muted">
					<KeyRound className="size-3.5" aria-hidden="true" />
					Each source has its own key. Open one to manage its installations.
				</div>
			) : null}
		</>
	);
}

function SourceSetup({
	type,
	wrkSlug,
	slug,
}: {
	type: string;
	wrkSlug: string;
	slug: string;
}) {
	const navigate = useNavigate();
	const label = sourceTypeLabel(type);
	const repPlatform = sourceSnippetPlatform(type);
	const endpoint = `${window.location.origin}/api/v2/ingest`;
	const isServer = repPlatform === "server";
	const installCmd = INSTALL_CMDS[repPlatform] ?? "";
	const initCode = sdkSnippet(
		repPlatform,
		isServer ? "ssk_YOUR_SOURCE_KEY" : "psk_YOUR_SOURCE_KEY",
		endpoint,
	);

	return (
		<div>
			<div className="mt-6 flex flex-col gap-[18px]">
				<StepRow num="01" label="Install" code={installCmd} prompt />
				<StepRow num="02" label="Initialize" code={initCode} />
			</div>
			<p className="mt-[18px] flex flex-wrap items-center gap-1.5 text-[12px] text-text-muted">
				Use a key from the{" "}
				<button
					type="button"
					onClick={() =>
						navigate(
							`/workspace/${wrkSlug}/projects/${slug}/sources/${type}/keys`,
						)
					}
					className="font-medium text-link transition-colors hover:underline"
				>
					{label} · Keys tab
				</button>{" "}
				when you initialize.
			</p>
		</div>
	);
}

function StepRow({
	num,
	label,
	code,
	prompt,
}: {
	num: string;
	label: string;
	code: string;
	prompt?: boolean;
}) {
	return (
		<div className="grid grid-cols-[30px_1fr] gap-2.5">
			<span className="pt-[3px] font-mono text-[11px] font-medium text-text-subtle">
				{num}
			</span>
			<div className="min-w-0">
				<div className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
					{label}
				</div>
				{prompt ? (
					<div className="flex h-[42px] items-center gap-2 rounded-[2px] bg-surface-raised pl-3">
						<span className="font-mono text-[13px] text-text-subtle">$</span>
						<code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-text">
							{code}
						</code>
						<CopyButton value={code} />
					</div>
				) : (
					<div className="space-y-1.5">
						<pre className="overflow-x-auto rounded-[2px] border border-border bg-surface-raised p-3 text-xs leading-relaxed text-text">
							{code}
						</pre>
						<div className="flex items-center gap-1.5">
							<CopyButton value={code} />
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function SourceKeys({
	sources,
	type,
	wrkSlug,
	slug,
	canManage,
}: {
	sources: SourceResource[];
	type: string;
	wrkSlug: string;
	slug: string;
	canManage: boolean;
}) {
	const label = sourceTypeLabel(type);
	const rows: Array<{ source: SourceResource; key: SourceKeyResource }> =
		sources.flatMap((source) => source.keys.map((key) => ({ source, key })));
	const firstSource = sources[0];
	const sourcePath = (id: string) =>
		`/workspace/${wrkSlug}/projects/${slug}/sources/${id}`;
	const canCreateKey = Boolean(canManage && firstSource);

	return (
		<div>
			<div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
				<div className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
					Keys for {label}
				</div>
				{canCreateKey ? (
					<CreateKeyButton slug={slug} sourceId={firstSource.id} />
				) : null}
			</div>

			{rows.length === 0 ? (
				<div className="flex flex-col items-center justify-center gap-2.5 rounded-[2px] border border-border p-6 text-center">
					<KeyRound
						className="size-[22px] text-text-subtle"
						aria-hidden="true"
					/>
					<p className="font-mono text-[13px] text-text-muted">
						No keys for this source type.
					</p>
					<span className="text-[12px] text-text-subtle">
						{canManage
							? `Create a ${label} source to generate its first key.`
							: "An owner or admin can create a source."}
					</span>
					{canManage ? (
						<div className="mt-1">
							<CreateSourceDialog
								slug={slug}
								initialPlatform={sourceSnippetPlatform(type)}
							/>
						</div>
					) : null}
				</div>
			) : (
				<div className="overflow-x-auto rounded-[2px] border border-border">
					<table className="w-full border-collapse text-[13px]">
						<thead>
							<tr className="bg-canvas-subtle text-text-muted">
								<th className="px-3.5 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em]">
									Source
								</th>
								<th className="px-3.5 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em]">
									Name
								</th>
								<th className="px-3.5 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em]">
									Key
								</th>
								<th className="px-3.5 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em]">
									Created
								</th>
								<th className="px-3.5 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em]">
									Last used
								</th>
								<th className="px-3.5 py-2.5 text-right font-mono text-[11px] font-medium uppercase tracking-[0.09em]">
									Actions
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.map(({ source, key }) => (
								<tr key={key.id} className="group border-t border-border">
									<td className="px-3.5 py-2.5">
										<Link
											to={sourcePath(source.id)}
											className="text-link hover:underline"
										>
											{source.name}
										</Link>
									</td>
									<td className="px-3.5 py-2.5 text-text">{key.name}</td>
									<td className="px-3.5 py-2.5">
										<code className="font-mono text-[12px] text-text-muted">
											{maskKey(key.value)}
										</code>
									</td>
									<td className="px-3.5 py-2.5 text-text-muted">
										{new Date(key.createdAt).toLocaleDateString()}
									</td>
									<td className="px-3.5 py-2.5 text-text-muted">
										{key.lastUsedAt
											? timeAgo(new Date(key.lastUsedAt).getTime())
											: "never"}
									</td>
									<td className="px-3.5 py-2.5">
										<span className="flex items-center justify-end gap-1 opacity-100 transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
											<CopyButton value={key.value} iconOnly />
											{canManage && key.status === "active" ? (
												<RevokeKeyButton
													slug={slug}
													sourceId={source.id}
													keyId={key.id}
													name={key.name}
												/>
											) : null}
										</span>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

function SourceSettings() {
	return (
		<p className="text-[13px] text-text-muted">
			Source settings aren't available yet.
		</p>
	);
}

// -------------------------------------------------------------------- page

export function ProjectSources() {
	const {
		slug,
		wrkSlug,
		type: typeParam,
		tab: tabParam,
		seg,
	} = useParams<{
		slug: string;
		wrkSlug: string;
		type?: string;
		tab?: string;
		seg?: string;
	}>();
	const navigate = useNavigate();
	// URL is the source of truth; unknown values fall back to defaults. The
	// type rides in `type` on the /:type/:tab route and in `seg` when it
	// arrives through the single-segment dispatch route (sources/:seg).
	const rawType = typeParam ?? seg;
	const type = rawType && SOURCE_TYPE_WORDS.includes(rawType) ? rawType : "web";
	const tab = tabParam && TAB_WORDS.includes(tabParam) ? tabParam : "overview";

	const { data, isLoading, isError, refetch } = useSourcesQuery(slug);
	const projectQuery = useProjectQuery({ slug, duration: "seven-days" });
	const activeMember = useActiveMember();

	const canManage =
		activeMember?.data?.role === "owner" ||
		activeMember?.data?.role === "admin";

	const allSources = (data ?? []) as SourceResource[];
	const sources = allSources.filter((source) =>
		SOURCE_TYPE_PLATFORMS[type as keyof typeof SOURCE_TYPE_PLATFORMS].includes(
			source.platform,
		),
	);
	const projectName = (projectQuery.data as { name?: string } | undefined)
		?.name;
	const basePath = `/workspace/${wrkSlug}/projects/${slug}/sources`;

	if (!slug || !wrkSlug) return null;

	return (
		<div className="flex flex-1 flex-col space-y-6">
			<PageHeader
				title="Sources"
				description={`SDK sources for ${
					projectName ?? "this project"
				}. Pick a source to get its setup, keys, and settings.`}
			/>

			<div className="mt-10 mb-3.5 flex items-baseline gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
				Sources
			</div>

			{isLoading ? (
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{[0, 1, 2].map((i) => (
						<Frame key={i} className="p-3.5">
							<Skeleton className="size-[30px]" />
							<Skeleton className="mt-2 h-[14px] w-2/3" />
							<Skeleton className="mt-2 h-[11px] w-1/2" />
						</Frame>
					))}
				</div>
			) : (
				<div
					className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
					role="tablist"
					aria-label="Source types"
				>
					{SOURCE_TYPES.map((entry) => {
						const keysOfType = allSources
							.filter((source) =>
								SOURCE_TYPE_PLATFORMS[entry.type].includes(source.platform),
							)
							.flatMap((source) =>
								source.keys.filter((key) => key.status === "active"),
							);
						const active = entry.type === type;
						const statusText =
							keysOfType.length > 0
								? `Configured · ${keysOfType.length} ${
										keysOfType.length === 1 ? "key" : "keys"
									}`
								: "Not configured";
						return (
							<button
								key={entry.type}
								type="button"
								onClick={() => navigate(`${basePath}/${entry.type}`)}
								className={cn(
									"flex flex-col items-start gap-2 rounded-[2px] border p-[14px_14px_12px] text-left transition-colors",
									active
										? "border-accent/45 bg-accent-soft"
										: "border-border bg-surface hover:border-border-strong hover:bg-surface-hover",
								)}
								role="tab"
								aria-selected={active}
							>
								<span
									className={cn(
										"grid size-[30px] place-items-center rounded-[2px] border bg-surface-raised",
										active
											? "border-accent/40 text-accent"
											: "border-border text-text-muted",
									)}
								>
									<TypeIcon type={entry.type} className="size-[15px]" />
								</span>
								<b className="text-[13px] font-[550] text-text">
									{entry.label}
								</b>
								<span className="font-mono text-[11px] leading-[1.3] text-text-subtle">
									{statusText}
								</span>
							</button>
						);
					})}
				</div>
			)}

			<fieldset className="mt-4 m-0 inline-flex min-w-0 items-center overflow-hidden rounded-[2px] border border-border p-0">
				<legend className="sr-only">Source configuration</legend>
				{SOURCE_TABS.map((entry, index) => (
					<button
						key={entry.tab}
						type="button"
						onClick={() => navigate(`${basePath}/${type}/${entry.tab}`)}
						className={cn(
							"inline-flex h-8 items-center gap-1.5 px-3.5 text-[13px] font-medium transition-colors",
							index > 0 && "border-l border-border",
							tab === entry.tab
								? "bg-accent-soft text-text"
								: "text-text-muted hover:bg-surface-hover hover:text-text",
						)}
						aria-pressed={tab === entry.tab}
					>
						{entry.label}
					</button>
				))}
			</fieldset>

			{isError ? (
				<ErrorState
					title="Could not load sources"
					description="Prism could not reach the API."
					onRetry={() => refetch()}
				/>
			) : (
				<Frame className="mt-[13px] p-5">
					{tab === "setup" ? (
						<SourceSetup type={type} wrkSlug={wrkSlug} slug={slug} />
					) : tab === "keys" ? (
						<SourceKeys
							sources={sources}
							type={type}
							wrkSlug={wrkSlug}
							slug={slug}
							canManage={canManage}
						/>
					) : tab === "settings" ? (
						<SourceSettings />
					) : (
						<SourceOverview
							sources={sources}
							type={type}
							wrkSlug={wrkSlug}
							slug={slug}
							canManage={canManage}
						/>
					)}
				</Frame>
			)}
		</div>
	);
}
