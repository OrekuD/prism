import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useCreateProjectMutation } from "@/network/mutations/useCreateProjectMutation";
import { useActiveWorkspace, useWorkspaces } from "@/lib/workspace";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SECTION =
  "font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted";

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Create-project page (/:wrkSlug/projects/new). Full page (not a modal).
 * SDK/platform is chosen per source (after the project exists), not here;
 * the team dropdown picks which workspace the project is created in.
 */
export function NewProject() {
  const navigate = useNavigate();
  const { wrkSlug } = useParams();
  const { data: workspaces } = useWorkspaces();
  const { data: activeWorkspace } = useActiveWorkspace();
  const createProjectMutation = useCreateProjectMutation();

  const [name, setName] = React.useState("");
  const [teamId, setTeamId] = React.useState<string>("");

  const activeId = (activeWorkspace as { id?: string } | null)?.id;
  const list = (workspaces ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
  }>;

  // Pre-select the active workspace once it's loaded.
  React.useEffect(() => {
    if (!teamId) {
      setTeamId(activeId ?? list[0]?.id ?? "");
    }
  }, [teamId, activeId, list.length]);

  const selectedWorkspace =
    list.find((entry) => entry.id === teamId) ??
    (activeWorkspace as { id?: string; slug?: string } | null) ??
    list[0];

  const projectsPath = `/${wrkSlug ?? ""}/projects`;
  const isPending = createProjectMutation.isPending;
  const slug = slugify(name);
  const canSubmit = Boolean(name.trim()) && !isPending;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedWorkspace?.id || !name.trim() || isPending) return;
    try {
      await createProjectMutation.mutateAsync({
        organizationId: selectedWorkspace.id,
        name: name.trim(),
      });
      // Success toast + query invalidation happen in the mutation.
      navigate(projectsPath);
    } catch {
      // The mutation's onError already surfaced a toast.
    }
  }

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <div className="mb-8">
        <h1 className="font-mono text-[26px] font-[650] leading-[1.18] tracking-[-0.025em] text-text">
          Create a project
        </h1>
      </div>

      <form onSubmit={onSubmit} className="space-y-9">
        {/* Project name + Team */}
        <section className="flex w-full gap-6">
          <div className="flex-1 space-y-2.5">
            <div className={SECTION}>Project name</div>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="project-name"
              aria-label="Project name"
              autoFocus
            />
            <p className="font-mono text-[12px] text-text-subtle">
              {slug || "project-name"} — used in URLs & SDK config.
            </p>
          </div>

          <div className="flex-1 space-y-2.5">
            <div className={SECTION}>Team</div>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger aria-label="Team" className="w-full">
                <SelectValue placeholder="Select a team" />
              </SelectTrigger>
              <SelectContent>
                {list.length === 0 ? (
                  <p className="px-2 py-1.5 text-[13px] text-text-subtle">
                    No workspaces yet.
                  </p>
                ) : (
                  list.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <p className="font-mono text-[12px] text-text-subtle">
              Can access the project and receive alerts.
            </p>
          </div>
        </section>

        <div className="flex items-center gap-3 border-t border-border pt-6">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => navigate(projectsPath)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Create project
          </Button>
        </div>
      </form>
    </div>
  );
}
