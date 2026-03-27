import { useState } from "react";
import { SidebarLayout } from "./sidebar-layout";
import type { RiskLevel } from "./sidebar-item";

// Dummy data for the "Smart" Component to hold initially
const initialChats = [
  {
    id: "chat-1",
    title: "Quarterly Earnings Report Analysis",
    snippet: "Detected high hallucination probability globally...",
    riskLevel: "red" as RiskLevel,
  },
  {
    id: "chat-2",
    title: "Drafting user onboarding script",
    snippet: "A few potential contradictions in step 3...",
    riskLevel: "amber" as RiskLevel,
  },
  {
    id: "chat-3",
    title: "SQL Query Optimization",
    snippet: "Looks totally safe and perfectly scoped.",
    riskLevel: "green" as RiskLevel,
  },
  {
    id: "chat-4",
    title: "Summarizing research papers",
    snippet: "Model is unsure about specific dates.",
    riskLevel: "amber" as RiskLevel,
  },
  {
    id: "chat-5",
    title: "Brainstorming modern UI designs",
    snippet: "General suggestions, no factual claims.",
    riskLevel: "none" as RiskLevel,
  },
];

interface ChatSidebarContainerProps {
  activeChatId: string;
  onChatSelect: (id: string) => void;
}

export function ChatSidebarContainer({ activeChatId, onChatSelect }: ChatSidebarContainerProps) {
  const [chats, setChats] = useState(initialChats);

  const handleNewChat = () => {
    const newId = `chat-${Date.now()}`;
    setChats((prev) => [
      { id: newId, title: "New Session", snippet: "", riskLevel: "none" },
      ...prev,
    ]);
    onChatSelect(newId);
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
