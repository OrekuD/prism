import React from "react";
import { Link, useParams } from "react-router-dom";
import { Frame } from "@/components/public/frame";
import { PageHeader } from "@/components/public/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useSourcesQuery } from "@/network/queries/useSourcesQuery";
import { useCreateSourceMutation } from "@/network/mutations/useSourceMutations";
import { useActiveMember } from "@/lib/workspace";
import { WORKSPACE_PLATFORMS } from "@/lib/workspace";
import { Plus, Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PLATFORM_LABELS: Record<string, string> = {
  web: "Web",
  ios: "iOS",
  android: "Android",
  "react-native": "React Native",
  server: "Server API",
};

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function CreateSourceDialog({ slug }: { slug: string }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [platform, setPlatform] = React.useState<string>("web");
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
          <Plus className="size-4" /> New Sources
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[90vw] md:w-full rounded-lg">
        <DialogHeader>
          <DialogTitle>Create Source</DialogTitle>
          <DialogDescription>
            A source is one installation that sends data to this project — a web
            app, iOS app, Android app, React Native app, or server API. Its
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
                {WORKSPACE_PLATFORMS.map((value) => (
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
              {createMutation.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectSources() {
  const { slug, wrkSlug } = useParams<{ slug: string; wrkSlug: string }>();
  const { data, isLoading, isError, refetch } = useSourcesQuery(slug);

  return (
    <div className="flex flex-1 flex-col space-y-6">
      <PageHeader
        title="Sources"
        description="Installations that send telemetry to this project. Each source has its own ingestion key and SDK setup."
      >
        {slug ? <CreateSourceDialog slug={slug} /> : null}
      </PageHeader>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <Frame key={i} className="p-5">
              <Skeleton className="h-[18px] w-1/3" />
              <Skeleton className="mt-3 h-[60px]" />
            </Frame>
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title="Could not load sources"
          description="Prism could not reach the API."
          onRetry={() => refetch()}
        />
      ) : data && data.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.map((source) => {
            const activeKeyCount = source.keys.filter(
              (key) => key.status === "active"
            ).length;
            return (
              <Link
                to={`/workspace/${wrkSlug}/projects/${slug}/sources/${source.id}`}
                key={source.id}
                className="block h-full"
              >
                <Frame className="h-full p-5 transition-colors hover:border-border-strong hover:bg-surface-hover">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-text">
                      {source.name}
                    </h3>
                    <span className="shrink-0 rounded-[2px] border border-border px-[5px] py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-subtle">
                      {PLATFORM_LABELS[source.platform] ?? source.platform}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] text-text-muted">
                    {formatCount(source.telemetry.events)} events
                    {source.telemetry.lastReceivedAt
                      ? ` · last ${new Date(source.telemetry.lastReceivedAt).toLocaleString()}`
                      : " · no telemetry yet"}
                  </p>
                  <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-[12px] text-text-subtle">
                    <span>
                      {activeKeyCount} active key
                      {activeKeyCount === 1 ? "" : "s"}
                    </span>
                    {source.platform === "web" &&
                      source.allowedOrigins.length > 0 && (
                        <span>
                          · {source.allowedOrigins.length} allowed origin
                          {source.allowedOrigins.length === 1 ? "" : "s"}
                        </span>
                      )}
                  </div>
                </Frame>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState
          label="No sources"
          title="This project has no sources yet"
          description="Create a source to get its ingestion key and SDK setup instructions."
        />
      )}
    </div>
  );
}
