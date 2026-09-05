/**
 * Conversations dropdown (top-left, next to the crumbs).
 * 1:1 replica of the design mock, wired to real chats: the toggle shows
 * the selected chat title, the menu lists the member's project chats
 * with hover delete, `+ New chat` starts a clean topic, Escape and
 * outside clicks close the menu.
 */
import { useEffect, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
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

// Custom menu rows carry per-chat delete actions, which a native select
// cannot express — hence the listbox/option roles on buttons.
function DropdownMenu({ children }: { children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: custom menu with per-row delete actions, not expressible as a native select
    <div
      role="listbox"
      aria-label="Conversations"
      tabIndex={-1}
      className="absolute left-0 top-[calc(100%+8px)] z-50 w-[300px] rounded-sm border border-border-strong bg-surface-raised p-1.5 shadow-[0_24px_80px_rgb(0_0_0/0.45)]"
    >
      {children}
    </div>
  );
}

function DropdownOption({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // biome-ignore lint/a11y/useSemanticElements: role=option on a button keeps keyboard operability that a native option lacks here
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-sm py-2 pl-2.5 pr-[34px] text-left text-[13px] font-medium transition-colors duration-100",
        selected
          ? "bg-accent-soft text-text"
          : "text-text-muted hover:bg-surface-hover hover:text-text",
      )}
    >
      {children}
    </button>
  );
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  return (
    <div ref={wrapRef} className="relative flex-none">
      <button
        ref={toggleRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Conversations"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="flex h-[30px] max-w-[260px] items-center gap-2 rounded-sm border border-border bg-surface px-2.5 text-[12.5px] font-medium text-text transition-colors duration-100 hover:border-border-strong hover:bg-surface-hover"
      >
        <MessageSquareText
          aria-hidden="true"
          className="h-[13px] w-[13px] flex-none"
        />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">
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
      {open ? (
        <DropdownMenu>
          <div className="mb-1.5 border-b border-border pb-1.5">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onNewChat();
            }}
            className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[13px] font-medium text-text-muted transition-colors duration-100 hover:bg-surface-hover hover:text-text"
          >
            <span>+ New chat</span>
          </button>
        </div>
        {items.length === 0 ? (
          <p className="px-2.5 py-3 font-mono text-[11px] text-text-subtle">
            No chats yet — ask a question to start one.
          </p>
        ) : null}
        {items.map((item) => {
          const active = item.id === selectedId;
          return (
            <div key={item.id} className="relative">
              <DropdownOption
                selected={active}
                onSelect={() => {
                  setOpen(false);
                  onSelect(item.id);
                }}
              >
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {item.title}
                </span>
                {(() => {
                  const meta = timeMeta(item.lastMessageAt);
                  return meta ? (
                    <span className="m-0 flex-none font-mono text-[10px] font-normal leading-none text-text-subtle">
                      {meta}
                    </span>
                  ) : null;
                })()}
              </DropdownOption>
              <button
                type="button"
                aria-label={`Delete ${item.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(item.id);
                }}
                className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-sm leading-none text-text-subtle opacity-0 transition-all duration-100 hover:bg-surface-hover hover:text-danger focus-visible:opacity-100 [.relative:hover_&]:opacity-100"
              >
                ×
              </button>
            </div>
          );
        })}
      </DropdownMenu>
      ) : null}
    </div>
  );
}
