/**
 * Conversations dropdown built on the shared shadcn dropdown-menu
 * primitive (same as the sidebar project/theme menus). The trigger
 * keeps the design-mock language (chat icon, current title, chevron);
 * the menu lists the member's project chats with hover delete. `+ New
 * chat` renders only in the chat tab.
 */
import { useState } from "react";
import { MessageSquareText, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ConversationListItem } from "@/network/queries/useAssistantConversations";
import { cn } from "@/lib/utils";

function startOfDay(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Relative time for today's chats: "just now", "Xm ago", "Xh ago". */
function todayMeta(value: number | null): string | null {
  if (value === null) return null;
  const diffMs = Date.now() - value;
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  return `${Math.floor(diffMs / 3_600_000)}h ago`;
}

function dateMeta(value: number | null): string | null {
  if (value === null) return null;
  return new Date(value).toISOString().slice(0, 10);
}

type DayGroup = { label: string; items: ConversationListItem[] };

/** Group chats by recency: Today, Yesterday, Previous 7/30 days, Older. */
function groupByDay(
  items: ConversationListItem[],
  now: number,
): DayGroup[] {
  const today = startOfDay(now);
  const groups: DayGroup[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Previous 30 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const item of items) {
    const at = item.lastMessageAt;
    const dayIndex =
      at === null || at < today - 30 * 86_400_000
        ? 4
        : at >= today
          ? 0
          : at >= today - 86_400_000
            ? 1
            : at >= today - 7 * 86_400_000
              ? 2
              : 3;
    groups[dayIndex]?.items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}

export function ConversationsDropdown({
  items,
  selectedSlug,
  onSelect,
  onNewChat,
  onDelete,
}: {
  items: ConversationListItem[];
  selectedSlug: string | null;
  onSelect: (conversationSlug: string) => void;
  onNewChat: () => void;
  onDelete: (conversationSlug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.slug === selectedSlug) ?? null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Conversations"
          className="flex h-[30px] max-w-[260px] items-center gap-1.5 rounded-[2px] border border-border bg-surface py-0 pl-2.5 pr-2 text-[12.5px] font-medium text-text transition-colors hover:border-border-strong hover:bg-surface-hover"
        >
          <MessageSquareText
            aria-hidden="true"
            className="h-[13px] w-[13px] flex-none"
          />
          <span className="flex-1 truncate text-left">
            {selected?.title ?? "New chat"}
          </span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-[13px] w-[13px] flex-none text-text-subtle"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={8} className="w-[300px]">
        <DropdownMenuItem
          onClick={() => onNewChat()}
          className="gap-2 font-medium"
        >
          <Plus className="size-4" />
          <span className="flex-1">New chat</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {groupByDay(items, Date.now()).map((group) => (
          <div key={group.label}>
            <p
              aria-hidden="true"
              className="px-2 pb-0.5 pt-2 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-text-subtle"
            >
              {group.label}
            </p>
            {group.items.map((item) => {
              const active = item.slug === selectedSlug;
              const meta =
                group.label === "Today"
                  ? todayMeta(item.lastMessageAt)
                  : dateMeta(item.lastMessageAt);
              return (
                <div key={item.id} className="group relative flex items-center">
                  <DropdownMenuItem
                    onClick={() => onSelect(item.slug)}
                    className={cn(
                      "min-w-0 flex-1 gap-2 pr-8",
                      active && "bg-accent-soft text-text",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {meta ? (
                      <span className="ml-auto flex-none font-mono text-[10px] text-text-subtle">
                        {meta}
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                  <button
                    type="button"
                    aria-label={`Delete ${item.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpen(false);
                      onDelete(item.slug);
                    }}
                    className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[2px] text-sm leading-none text-text-subtle opacity-0 transition-all hover:bg-surface-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
