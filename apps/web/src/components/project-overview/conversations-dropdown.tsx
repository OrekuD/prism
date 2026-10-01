import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  MessageSquareText,
  Plus,
  SearchIcon,
} from "@/components/ui/hugeicons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ConversationListItem } from "@/network/queries/useAssistantConversations";
import { cn } from "@/lib/utils";

function startOfDay(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function chatTime(value: number | null, today: boolean): string {
  if (value === null) return "";
  if (!today) return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

type DayGroup = { label: string; items: ConversationListItem[] };

function groupByDay(items: ConversationListItem[], now: number): DayGroup[] {
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
    const index = at === null || at < today - 30 * 86_400_000
      ? 4
      : at >= today
        ? 0
        : at >= today - 86_400_000
          ? 1
          : at >= today - 7 * 86_400_000
            ? 2
            : 3;
    groups[index]?.items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}

export function ConversationsDropdown({
  items,
  selectedSlug,
  selectedTitle,
  onSelect,
  onNewChat,
  onPrefetch,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
}: {
  items: ConversationListItem[];
  selectedSlug: string | null;
  selectedTitle?: string | null;
  onSelect: (conversationSlug: string) => void;
  onNewChat: () => void;
  onPrefetch?: (conversationSlug: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = items.find((item) => item.slug === selectedSlug) ?? null;
  const groups = useMemo(
    () => groupByDay(items.filter((item) =>
      item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    ), Date.now()),
    [items, search],
  );

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) setSearch("");
      if (nextOpen) {
        for (const item of items.filter((item) => item.slug !== selectedSlug).slice(0, 3)) {
          onPrefetch?.(item.slug);
        }
      }
    }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Conversations"
          aria-expanded={open}
          className="inline-flex h-9 min-w-0 max-w-[min(56vw,360px)] items-center gap-2 rounded-lg px-2.5 text-left text-sm font-medium text-text transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
        >
          <MessageSquareText aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
          <span className="truncate">{selected?.title ?? selectedTitle ?? "Conversations"}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[min(380px,calc(100vw-2rem))] rounded-xl border-border bg-surface-raised p-1.5 shadow-[0_18px_48px_rgb(0_0_0/0.25)]"
      >
        <div className="flex h-10 items-center gap-2 border-b border-border px-2.5">
          <SearchIcon aria-hidden="true" className="size-4 text-text-subtle" />
          <input
            type="search"
            aria-label="Search conversations"
            placeholder="Search conversations"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-subtle"
          />
        </div>
        <button
          type="button"
          onClick={() => { setOpen(false); onNewChat(); }}
          className="mt-1 flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm text-text hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Plus aria-hidden="true" className="size-4 text-text-muted" />
          New chat
        </button>
        <div className="max-h-[min(50dvh,380px)] overflow-y-auto border-t border-border pt-1">
          {groups.length === 0 ? (
            <p className="px-2.5 py-5 text-center text-sm text-text-muted">
              {search ? "No matching conversations" : "No conversations yet"}
            </p>
          ) : groups.map((group) => (
            <div key={group.label} className="pb-1">
              <p className="px-2.5 pb-1 pt-3 text-[11px] font-medium text-text-subtle">
                {group.label}
              </p>
              {group.items.map((item) => {
                const active = item.slug === selectedSlug;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onPointerEnter={() => onPrefetch?.(item.slug)}
                    onFocus={() => onPrefetch?.(item.slug)}
                    onClick={() => { setOpen(false); onSelect(item.slug); }}
                    className={cn(
                      "flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-focus",
                      active && "bg-surface-active text-text",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <span className="shrink-0 text-[11px] text-text-subtle">
                      {chatTime(item.lastMessageAt, group.label === "Today")}
                    </span>
                    {active ? <Check aria-hidden="true" className="size-3.5 shrink-0" /> : null}
                  </button>
                );
              })}
            </div>
          ))}
          {hasMore ? (
            <button
              type="button"
              disabled={loadingMore}
              onClick={onLoadMore}
              className="mt-1 h-9 w-full rounded-lg border-t border-border px-2.5 text-left text-xs text-text-muted hover:text-text disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load older conversations"}
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
