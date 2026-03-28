import { useState, useEffect } from "react";
import { ChatLayout } from "./chat-layout";
import type { MessageProps, HallucinationSpan } from "./chat-message-bubble";
import {
  fetchModels,
  sendChatMessage,
  detectHallucinations,
  scoreToRisk,
  getConversation,
  addMessageToConversation,
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

export function ChatContainer({ activeChatId }: ChatContainerProps) {
  const [panes, setPanes] = useState<ChatPaneData[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isModelSelectionLocked, setIsModelSelectionLocked] = useState(false);
  const [models, setModels] = useState<BackendModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Load models from backend on mount ──────────────────────────────────
  useEffect(() => {
    fetchModels()
      .then((data) => {
        const available = data.filter((m) => m.available);
        setModels(available);
      })
      .catch((e) => {
        console.error("Failed to load models:", e);
        setError("Backend unreachable — is the server running on :8000 ?");
      })
      .finally(() => setModelsLoading(false));
  }, []);

  // ── Reset panes on new session ──────────────────────────────────────────
  useEffect(() => {
    if (!activeChatId) return;
    
    console.log(`[ChatContainer] Loading conversation ID: ${activeChatId}`);
    
    getConversation(activeChatId).then(conv => {
      const firstModel = models[0]?.id ?? "llama-3.3-70b-versatile";
      
      // If no messages, just clear panes to a blank first model
      if (!conv.messages || conv.messages.length === 0) {
        setPanes([{ id: `pane-root-${Date.now()}`, modelId: firstModel, messages: [] }]);
        setIsModelSelectionLocked(false);
        setIsThinking(false);
        setError(null);
        return;
      }

      // If we have messages, we only support a single unified thread loaded right now 
      // (Advanced branching logic would be needed to reconstruct multiple panes from db history)
      // For now, load history into a single pane
      const mappedMessages = conv.messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        spans: [] // Not persisted in DB right now, would need analysis matching
      }));
      
      const lastAssitantMsg = conv.messages.filter(m => m.role === "assistant").pop();

      setPanes([{ 
        id: `pane-root-${Date.now()}`, 
        modelId: lastAssitantMsg?.model_id || firstModel, 
        messages: mappedMessages 
      }]);
      setIsModelSelectionLocked(true); // Locked if history exists
      setIsThinking(false);
      setError(null);
      
    }).catch(err => {
      console.error(`Failed to load conversation ${activeChatId}`, err);
    })

  }, [activeChatId, models]);

  const handleAddPane = () => {
    if (isModelSelectionLocked || panes.length >= 3) {
      return;
    }

    const newPaneId = `pane-${Date.now()}`;
    const usedModels = new Set(panes.map((pane) => pane.modelId));
    const nextModel =
      models.find((model) => !usedModels.has(model.id))?.id ||
      models[1]?.id ||
      panes[0]?.modelId ||
      "llama-3.3-70b-versatile";

    setPanes((prev) => [
      ...prev,
      { id: newPaneId, modelId: nextModel, messages: [] },
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
    setIsModelSelectionLocked(true);

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
    
    // Save user message to database (using the activeChatId)
    if (activeChatId) {
      try {
        await addMessageToConversation(activeChatId, "user", content);
        console.log(`[ChatContainer] Saved user message to conversation ${activeChatId}`);
        // Notify sidebar to refresh, in case this is the first message that sets the title
        window.dispatchEvent(new Event("refresh-sidebar"));
      } catch (err) {
        console.error("Failed to save user message to DB", err);
      }
    }

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
              score: claim.risk_score,
              status: claim.status,
              claimType: claim.type,
              claimId: claim.id,
              citations: (claim.verification_details?.evidence || [])
                .map((evidence) => evidence.source_title || evidence.source_url || evidence.source_type)
                .filter(Boolean)
                .slice(0, 4),
              explanation: claim.verification_details.evidence[0]?.snippet
                ?? "Backend did not return evidence snippet for this claim yet.",
            }));
        } catch (detErr) {
          console.warn("Detection failed (non-fatal):", detErr);
        }
        
        // Save AI message to DB
        if (activeChatId) {
          try {
            await addMessageToConversation(activeChatId, "assistant", responseText, pane.modelId);
            console.log(`[ChatContainer] Saved AI message (model: ${pane.modelId}) to conversation ${activeChatId}`);
          } catch (err) {
            console.error("Failed to save AI message to DB", err);
          }
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
        canAddPane={!isModelSelectionLocked}
        models={models}
      />
    </>
  );
}
