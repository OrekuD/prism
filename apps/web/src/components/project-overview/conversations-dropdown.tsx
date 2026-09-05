/**
 * Conversations dropdown built on the shared shadcn dropdown-menu
 * primitive (same as the sidebar project/theme menus). The trigger
 * keeps the design-mock language (chat icon, current title, chevron);
 * the menu lists the member's project chats with hover delete. `+ New
 * chat` renders only in the chat tab.
 */
import { useState } from "react";
import { Check, MessageSquareText, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ConversationListItem } from "@/network/queries/useAssistantConversations";
import { cn } from "@/lib/utils";

function timeMeta(value: number | null): string | null {
  if (value === null) return null;
  const diffDays = Math.floor((Date.now() - value) / 86_400_000);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(value).toISOString().slice(0, 10);
}

export function ConversationsDropdown({
  items,
  selectedId,
  onSelect,
  onNewChat,
  onDelete,
}: {
  items: ConversationListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Conversations"
          className="flex h-[30px] max-w-[260px] items-center gap-2 rounded-[2px] border border-border bg-surface px-2.5 text-[12.5px] font-medium text-text transition-colors hover:border-border-strong hover:bg-surface-hover"
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
        <DropdownMenuLabel>Conversations</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => onNewChat()}
          className="gap-2 font-medium"
        >
          <Plus className="size-4" />
          <span className="flex-1">New chat</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="px-2 py-1.5 text-[13px] text-text-subtle">
            No chats yet — ask a question to start one.
          </div>
        ) : (
          items.map((item) => {
            const active = item.id === selectedId;
            const meta = timeMeta(item.lastMessageAt);
            return (
              <div key={item.id} className="group relative flex items-center">
                <DropdownMenuItem
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    "min-w-0 flex-1 gap-2 pr-8",
                    active && "bg-accent-soft text-text",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {meta ? (
                    <span className="flex-none font-mono text-[10px] text-text-subtle">
                      {meta}
                    </span>
                  ) : null}
                  {active ? (
                    <Check className="size-3.5 flex-none text-accent" />
                  ) : null}
                </DropdownMenuItem>
                <button
                  type="button"
                  aria-label={`Delete ${item.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(false);
                    onDelete(item.id);
                  }}
                  className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[2px] text-sm leading-none text-text-subtle opacity-0 transition-all hover:bg-surface-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                >
                  ×
                </button>
              </div>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
