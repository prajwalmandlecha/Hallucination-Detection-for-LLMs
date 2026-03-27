import { useState, useEffect } from "react";
import { ChatLayout } from "./chat-layout";
import type { MessageProps } from "./chat-message-bubble";

export type ModelId = "gpt-4" | "claude-3" | "gemini-1.5";

export interface ChatPaneData {
  id: string;
  modelId: ModelId;
  messages: MessageProps[];
}

// Map simulating basic responses per model to make prototyping easier.
const getSimulatedResponse = (modelId: ModelId, content: string): Pick<MessageProps, "content" | "spans"> => {
  if (modelId === "gemini-1.5") {
    return {
      content: `I've quickly parsed: "${content}". Proceeding with efficient streaming...`,
      spans: [{ text: "efficient streaming", risk: "green", explanation: "Verified capability." }],
    };
  }
  if (modelId === "claude-3") {
    return {
      content: `Analyzing nuances of "${content}". Initial safety checks passed.`,
    };
  }
  return {
    content: `Response synthesized for "${content}". Note potential edge cases in 2024 implementation details.`,
    spans: [{ text: "2024 implementation details", risk: "amber", explanation: "Self-reported uncertainty regarding timeframe." }],
  };
};

const getModelDelay = (modelId: ModelId) => {
  if (modelId === "gemini-1.5") return 800;
  if (modelId === "claude-3") return 1200;
  return 1600;
};

interface ChatContainerProps {
  activeChatId: string;
}

export function ChatContainer({ activeChatId }: ChatContainerProps) {
  const [panes, setPanes] = useState<ChatPaneData[]>([
    {
      id: "pane-root",
      modelId: "gpt-4",
      messages: [
        {
          id: "sys-0",
          role: "assistant",
          content: "I'm analyzing your request. Here are the details you asked for. The architecture relies on a few key principles: scalability, maintainability, and performance. Let me know if you need more details!",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }
      ],
    },
  ]);
  const [isThinking, setIsThinking] = useState(false);

  // Reset to single pane when activeChatId changes (e.g. hitting "New Session")
  useEffect(() => {
    setPanes([
      {
        id: `pane-root-${Date.now()}`,
        modelId: "gpt-4",
        messages: [
          {
            id: `sys-init-${Date.now()}`,
            role: "assistant",
            content: "Ready for parallel analysis.",
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }
        ],
      },
    ]);
    setIsThinking(false);
  }, [activeChatId]);

  const handleAddPane = () => {
    if (panes.length >= 3) return; // Hard limit at 3
    const newPaneId = `pane-${Date.now()}`;
    const defaultModel: ModelId = "claude-3"; // Just default picking one
    setPanes((prev) => [
      ...prev,
      {
        id: newPaneId,
        modelId: defaultModel,
        messages: [
          {
            id: `sys-init-${newPaneId}`,
            role: "assistant",
            content: "Ready for parallel analysis.",
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }
        ],
      },
    ]);
  };

  const handleChangeModel = (paneId: string, newModelId: ModelId) => {
    setPanes((prev) =>
      prev.map((pane) => (pane.id === paneId ? { ...pane, modelId: newModelId } : pane))
    );
  };

  const handleRemovePane = (paneId: string) => {
    setPanes((prev) => prev.filter((p) => p.id !== paneId));
  };

  const handleSendMessage = (content: string) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    // Instantly append the User message to all visible panes
    setPanes((prev) =>
      prev.map((pane) => ({
        ...pane,
        messages: [
          ...pane.messages,
          { id: `usr-${pane.id}-${Date.now()}`, role: "user", content, timestamp },
        ],
      }))
    );

    setIsThinking(true);

    // Replicate async responses for all active panes
    panes.forEach((pane) => {
      const delay = getModelDelay(pane.modelId);
      const simulatedData = getSimulatedResponse(pane.modelId, content);

      setTimeout(() => {
        setPanes((currentPanes) =>
          currentPanes.map((p) => {
            if (p.id !== pane.id) return p;
            return {
              ...p,
              messages: [
                ...p.messages,
                {
                  id: `sys-${p.id}-${Date.now()}`,
                  role: "assistant",
                  content: simulatedData.content,
                  spans: simulatedData.spans,
                  timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                },
              ],
            };
          })
        );

        // Turn off 'isThinking' roughly after the last model theoretically finishes.
        // For production, this would track a counter of pending requests.
        setIsThinking(false);
      }, delay);
    });
  };

  return (
    <ChatLayout
      panes={panes}
      isThinking={isThinking}
      onSendMessage={handleSendMessage}
      onAddPane={handleAddPane}
      onChangeModel={handleChangeModel}
      onRemovePane={handleRemovePane}
    />
  );
}
