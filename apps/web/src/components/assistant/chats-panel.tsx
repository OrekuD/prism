/**
 * Chats history panel (Task 21 slice 7): compact panel on desktop,
 * full-height sheet on mobile. Ordered by `lastMessageAt`, selected
 * chat marked `aria-current="page"`, fully keyboard navigable.
 */
import { MessageSquarePlus, Trash2, X } from "lucide-react";
import type { ConversationListItem } from "@/network/queries/useAssistantConversations";
import { cn } from "@/lib/utils";

function timeLabel(value: number | null): string {
  if (value === null) return "no messages yet";
  const date = new Date(value);
  const now = Date.now();
  const diffDays = Math.floor((now - value) / 86_400_000);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toISOString().slice(0, 10);
}

export function ChatsPanel({
  items,
  selectedId,
  runningConversationId,
  onSelect,
  onNewChat,
  onDelete,
  onClose,
}: {
  items: ConversationListItem[];
  selectedId: string | null;
  runningConversationId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Project chats"
      className="fixed inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col border-l border-border bg-background shadow-xl sm:absolute sm:inset-y-auto sm:right-0 sm:top-12 sm:max-h-[70vh] sm:rounded-xl sm:border"
    >
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <p className="font-mono text-xs uppercase tracking-wider text-text-subtle">
          Chats
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNewChat}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs text-accent hover:bg-accent/10"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
            New chat
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat history"
            className="rounded-md p-1.5 text-text-subtle hover:bg-border-subtle hover:text-text"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <ol className="flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <li className="px-3 py-6 text-center font-mono text-xs text-text-subtle">
            No chats yet. Ask a question to start one.
          </li>
        ) : null}
        {items.map((item) => {
          const selected = item.id === selectedId;
          return (
            <li key={item.id}>
              <div
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-3 py-2",
                  selected ? "bg-accent/10" : "hover:bg-border-subtle/50",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-current={selected ? "page" : undefined}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm">{item.title}</span>
                  <span className="mt-0.5 block font-mono text-[11px] text-text-subtle">
                    {timeLabel(item.lastMessageAt)}
                    {item.id === runningConversationId || item.hasActiveRun ? (
                      <span className="ml-2 text-accent">· running</span>
                    ) : null}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  aria-label={`Delete chat ${item.title}`}
                  className="shrink-0 rounded-md p-1.5 text-text-subtle opacity-0 hover:bg-danger/10 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
