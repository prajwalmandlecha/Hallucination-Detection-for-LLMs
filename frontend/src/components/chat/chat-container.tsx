import { useState, useEffect } from "react";
import { ChatLayout } from "./chat-layout";
import type { MessageProps, HallucinationSpan } from "./chat-message-bubble";
import {
  fetchModels,
  sendChatMessage,
  detectHallucinations,
  scoreToRisk,
  type BackendModel,
  type ChatMessage,
} from "@/lib/api";

// ModelId is now dynamic — just a string alias
export type ModelId = string;

export interface ChatPaneData {
  id: string;
  modelId: ModelId;
  messages: MessageProps[];
}

interface ChatContainerProps {
  activeChatId: string;
}

const WELCOME_MSG = "Ready for parallel analysis. Type a message to begin.";

function makeWelcome(paneId: string): MessageProps {
  return {
    id: `sys-init-${paneId}`,
    role: "assistant",
    content: WELCOME_MSG,
    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
}

export function ChatContainer({ activeChatId }: ChatContainerProps) {
  const [panes, setPanes] = useState<ChatPaneData[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [models, setModels] = useState<BackendModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Load models from backend on mount ──────────────────────────────────
  useEffect(() => {
    fetchModels()
      .then((data) => {
        const available = data.filter((m) => m.available);
        setModels(available);
        // Init first pane with first available model
        const firstModel = available[0]?.id ?? "llama-3.3-70b-versatile";
        setPanes([{ id: "pane-root", modelId: firstModel, messages: [makeWelcome("pane-root")] }]);
      })
      .catch((e) => {
        console.error("Failed to load models:", e);
        setError("Backend unreachable — is the server running on :8000 ?");
        // Fallback pane so UI doesn't break
        setPanes([{ id: "pane-root", modelId: "llama-3.3-70b-versatile", messages: [makeWelcome("pane-root")] }]);
      })
      .finally(() => setModelsLoading(false));
  }, []);

  // ── Reset panes on new session ──────────────────────────────────────────
  useEffect(() => {
    if (models.length === 0) return;
    const firstModel = models[0]?.id ?? "llama-3.3-70b-versatile";
    const paneId = `pane-root-${Date.now()}`;
    setPanes([{ id: paneId, modelId: firstModel, messages: [makeWelcome(paneId)] }]);
    setIsThinking(false);
    setError(null);
  }, [activeChatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add comparison pane ─────────────────────────────────────────────────
  const handleAddPane = () => {
    if (panes.length >= 3) return;
    const newPaneId = `pane-${Date.now()}`;
    // Pick second available model different from pane[0]
    const usedModels = new Set(panes.map((p) => p.modelId));
    const nextModel = models.find((m) => !usedModels.has(m.id))?.id ?? models[1]?.id ?? panes[0].modelId;
    setPanes((prev) => [
      ...prev,
      { id: newPaneId, modelId: nextModel, messages: [makeWelcome(newPaneId)] },
    ]);
  };

  const handleChangeModel = (paneId: string, newModelId: ModelId) => {
    setPanes((prev) => prev.map((p) => (p.id === paneId ? { ...p, modelId: newModelId } : p)));
  };

  const handleRemovePane = (paneId: string) => {
    setPanes((prev) => prev.filter((p) => p.id !== paneId));
  };

  // ── Send message → chat → detect ────────────────────────────────────────
  const handleSendMessage = async (content: string) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setError(null);

    // 1. Append user message instantly to all panes
    setPanes((prev) =>
      prev.map((pane) => ({
        ...pane,
        messages: [
          ...pane.messages,
          { id: `usr-${pane.id}-${Date.now()}`, role: "user" as const, content, timestamp },
        ],
      }))
    );

    setIsThinking(true);

    // 2. Fire a real API call for each pane in parallel
    const currentPanes = panes; // snapshot before state updates

    const paneRequests = currentPanes.map(async (pane) => {
      // Build conversation history from existing messages (excluding the just-added user msg)
      const history: ChatMessage[] = pane.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      try {
        // Step A: get chat response
        const responseText = await sendChatMessage(pane.modelId, content, history);

        // Step B: run detection on the response
        const historyWithUser: ChatMessage[] = [
          ...history,
          { role: "user", content },
        ];

        let spans: HallucinationSpan[] | undefined;
        try {
          const detection = await detectHallucinations(pane.modelId, responseText, historyWithUser);
          spans = detection.claims
            .filter((c) => c.status !== "SKIPPED")
            .map((claim) => ({
              text: claim.text,
              risk: scoreToRisk(claim.risk_score),
              explanation: claim.verification_details.evidence[0]?.snippet
                ?? `Status: ${claim.status} | Score: ${claim.risk_score.toFixed(0)}/100`,
            }));
        } catch (detErr) {
          console.warn("Detection failed (non-fatal):", detErr);
        }

        return { paneId: pane.id, responseText, spans };
      } catch (chatErr) {
        const msg = chatErr instanceof Error ? chatErr.message : String(chatErr);
        return { paneId: pane.id, responseText: `⚠️ Error: ${msg}`, spans: undefined };
      }
    });

    // 3. As each pane resolves, append its AI message
    let pendingCount = paneRequests.length;
    const aiTimestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    paneRequests.forEach((req) => {
      req.then(({ paneId, responseText, spans }) => {
        setPanes((currentPanes) =>
          currentPanes.map((p) => {
            if (p.id !== paneId) return p;
            return {
              ...p,
              messages: [
                ...p.messages,
                {
                  id: `ai-${paneId}-${Date.now()}`,
                  role: "assistant" as const,
                  content: responseText,
                  spans,
                  timestamp: aiTimestamp,
                },
              ],
            };
          })
        );
        pendingCount -= 1;
        if (pendingCount === 0) setIsThinking(false);
      });
    });
  };

  if (modelsLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-mut text-sm">
        Connecting to backend…
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500/10 border border-red-500/30 text-red-500 text-xs px-4 py-2 rounded-full shadow">
          {error}
        </div>
      )}
      <ChatLayout
        panes={panes}
        isThinking={isThinking}
        onSendMessage={handleSendMessage}
        onAddPane={handleAddPane}
        onChangeModel={handleChangeModel}
        onRemovePane={handleRemovePane}
        models={models}
      />
    </>
  );
}
