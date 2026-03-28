import { useState, useEffect } from "react";
import { SidebarLayout } from "./sidebar-layout";
import type { RiskLevel } from "./sidebar-item";
import { fetchConversations, createConversation } from "@/lib/api";

interface ChatSidebarContainerProps {
  activeChatId: string;
  onChatSelect: (id: string) => void;
}

export function ChatSidebarContainer({ activeChatId, onChatSelect }: ChatSidebarContainerProps) {
  const [chats, setChats] = useState<Array<{id: string; title: string; snippet: string; riskLevel: RiskLevel}>>([]);

  const loadConversations = () => {
    fetchConversations().then((data) => {
      const formatted = data.map(conv => ({
        id: conv.id,
        title: conv.metadata?.title || "Session",
        snippet: `Started at ${new Date(conv.created_at).toLocaleDateString()}`,
        riskLevel: "none" as RiskLevel
      }));
      setChats(formatted);
      if (formatted.length > 0 && !activeChatId) {
        onChatSelect(formatted[0].id);
      }
    }).catch(err => {
      console.error("Failed to load conversations in sidebar", err);
    });
  };

  useEffect(() => {
    loadConversations();

    const handleRefresh = () => {
      loadConversations();
    };

    window.addEventListener("refresh-sidebar", handleRefresh);
    return () => window.removeEventListener("refresh-sidebar", handleRefresh);
  }, [activeChatId, onChatSelect]);

  const handleNewChat = async () => {
    try {
      const newConv = await createConversation("New Session");
      console.log(`[Sidebar] Created new session with DB ID: ${newConv.id}`);
      setChats((prev) => [
        { id: newConv.id, title: newConv.metadata?.title || "New Session", snippet: "Brand new session", riskLevel: "none" },
        ...prev,
      ]);
      onChatSelect(newConv.id);
    } catch (err) {
      console.error("Failed to create new session", err);
    }
  };

  const handleSelectChat = (id: string) => {
    onChatSelect(id);
  };

  return (
    <SidebarLayout
      chats={chats}
      activeChatId={activeChatId}
      onNewChat={handleNewChat}
      onSelectChat={handleSelectChat}
      onOpenProfile={() => console.log("Open profile module...")}
      onOpenSettings={() => console.log("Open settings module...")}
    />
  );
}
