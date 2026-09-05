/**
 * Sticky page header: crumbs, conversations dropdown, range selector,
 * and the Overview/Chat view toggle. 1:1 replica of the design mock
 * (minus the theme toggle, which already lives in the app sidebar).
 */
import { Seg, SegTab } from "@/components/project-overview/primitives";
import { ConversationsDropdown } from "@/components/project-overview/conversations-dropdown";
import type { ConversationListItem } from "@/network/queries/useAssistantConversations";

export const OVERVIEW_RANGES = ["24h", "7d", "14d", "30d", "90d"] as const;

export function PageHeader({
  slug,
  view,
  onViewChange,
  range,
  onRangeChange,
  conversations,
  selectedChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
}: {
  slug: string;
  view: "overview" | "chat";
  onViewChange: (view: "overview" | "chat") => void;
  range: string;
  onRangeChange: (range: string) => void;
  conversations: ConversationListItem[];
  selectedChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => void;
}) {
  return (
    <header className="sticky top-0 z-30 -mx-1 flex min-h-14 items-center gap-3.5 border-b border-border bg-canvas/90 px-1 backdrop-blur-md max-[760px]:flex-wrap max-[760px]:py-2.5">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 whitespace-nowrap font-mono text-xs font-medium tracking-[0.02em] text-text-subtle"
      >
        <span>{slug}</span>
        <span aria-hidden="true" className="text-border-strong">
          /
        </span>
        <b className="font-medium text-text">
          {view === "chat" ? "Chat" : "Overview"}
        </b>
      </nav>
      <ConversationsDropdown
        items={conversations}
        selectedId={selectedChatId}
        onSelect={onSelectChat}
        onNewChat={onNewChat}
        onDelete={onDeleteChat}
      />
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2 max-[760px]:ml-0 max-[760px]:w-full max-[760px]:justify-start">
        <Seg label="Range">
          {OVERVIEW_RANGES.map((value) => (
            <SegTab
              key={value}
              selected={range === value}
              onClick={() => onRangeChange(value)}
            >
              {value}
            </SegTab>
          ))}
        </Seg>
        <Seg label="View">
          <SegTab
            selected={view === "overview"}
            onClick={() => onViewChange("overview")}
          >
            Overview
          </SegTab>
          <SegTab selected={view === "chat"} onClick={() => onViewChange("chat")}>
            Chat
          </SegTab>
        </Seg>
      </div>
    </header>
  );
}
