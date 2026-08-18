import React from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

  const canManage = admin?.data?.role === "owner" || admin?.data?.role === "admin";

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
        <Button disabled={!canManage} title={canManage ? undefined : "Members cannot create sources"}>
          <Plus className="size-4" /> New Source
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[90vw] md:w-full rounded-lg">
        <DialogHeader>
          <DialogTitle>Create Source</DialogTitle>
          <DialogDescription>
            A source is one installation that sends data to this project —
            a web app, iOS app, Android app, React Native app, or server API.
            Its initial ingestion key is created with it and shown once.
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
              <Button type="button" variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Create"}
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
    <div className="flex flex-1 flex-col py-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Sources</h2>
          <p className="text-sm text-muted-foreground">
            Installations that send telemetry to this project. Each source has
            its own ingestion key and SDK setup.
          </p>
        </div>
        {slug ? <CreateSourceDialog slug={slug} /> : null}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <Card key={i}>
              <CardHeader><Skeleton className="h-[18px] w-1/3" /></CardHeader>
              <CardContent><Skeleton className="h-[60px]" /></CardContent>
            </Card>
          ))}
        </div>
      ) : isError ? (
        <ErrorState title="Could not load sources" description="Prism could not reach the API." onRetry={() => refetch()} />
      ) : data && data.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.map((source) => (
            <Link to={`/${wrkSlug}/projects/${slug}/sources/${source.id}`} key={source.id}>
              <Card className="hover:border-accent transition-colors">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-md">{source.name}</CardTitle>
                    <Badge variant="outline">{PLATFORM_LABELS[source.platform] ?? source.platform}</Badge>
                  </div>
                  <CardDescription>
                    {formatCount(source.telemetry.events)} events
                    {source.telemetry.lastReceivedAt
                      ? ` · last ${new Date(source.telemetry.lastReceivedAt).toLocaleString()}`
                      : " · no telemetry yet"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>
                    {source.keys.filter((key) => key.status === "active").length} active key
                    {source.keys.filter((key) => key.status === "active").length === 1 ? "" : "s"}
                  </span>
                  {source.platform === "web" && source.allowedOrigins.length > 0 && (
                    <span>· {source.allowedOrigins.length} allowed origin{source.allowedOrigins.length === 1 ? "" : "s"}</span>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
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
