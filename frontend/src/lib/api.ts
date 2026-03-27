const API_BASE = "http://localhost:8000/api/v1";

export interface BackendModel {
  id: string;
  name: string;
  provider: string;
  tier: number;
  available: boolean;
  free: boolean;
  description: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface DetectionClaim {
  id: string;
  text: string;
  type: string;
  risk_score: number;
  status: "VERIFIED" | "UNVERIFIED" | "CONTRADICTED" | "SKIPPED";
  verification_details: {
    entailment_score: number;
    contradiction_score: number;
    sources_checked: string[];
    evidence: Array<{
      source_type: string;
      source_url?: string;
      source_title?: string;
      snippet: string;
      nli_label?: string;
      nli_scores?: Record<string, number>;
    }>;
  };
}

export interface DetectionResult {
  response_id: string;
  overall_risk_score: number;
  risk_level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  risk_color: string;
  warning_message: string;
  warnings: Array<{ type: string; message: string; claim_id: string; source_url?: string }>;
  claims: DetectionClaim[];
  metadata: {
    processing_time_ms: number;
    claims_extracted: number;
    claims_verified: number;
    claims_skipped: number;
    sources_queried: string[];
  };
}

export interface Conversation {
  id: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    model_id?: string;
    created_at: string;
  }>;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE}/conversations`);
  if (!res.ok) throw new Error("Failed to fetch conversations");
  return res.json() as Promise<Conversation[]>;
}

export async function getConversation(id: string): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/conversations/${id}`);
  if (!res.ok) throw new Error("Failed to load conversation");
  return res.json() as Promise<Conversation>;
}

export async function createConversation(title: string = "New Session"): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metadata: { title } })
  });
  if (!res.ok) throw new Error("Failed to create conversation");
  return res.json() as Promise<Conversation>;
}

export async function addMessageToConversation(
  convId: string,
  role: "user" | "assistant",
  content: string,
  modelId?: string
) {
  const res = await fetch(`${API_BASE}/conversations/${convId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, content, model_id: modelId })
  });
  if (!res.ok) throw new Error("Failed to add message");
  return res.json();
}

/** Fetch all available models from the backend. */
export async function fetchModels(): Promise<BackendModel[]> {
  const res = await fetch(`${API_BASE}/models`);
  if (!res.ok) throw new Error("Failed to fetch models");
  const data = await res.json();
  return data.models as BackendModel[];
}

/** Send a chat message (non-streaming). Returns the AI response text. */
export async function sendChatMessage(
  modelId: string,
  message: string,
  history: ChatMessage[]
): Promise<string> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: modelId,
      message,
      conversation_history: history,
      stream: false,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `Chat failed: ${res.status}`);
  }
  const data = await res.json();
  return data.response as string;
}

/** Run hallucination detection on an AI response. */
export async function detectHallucinations(
  modelId: string,
  modelResponse: string,
  history: ChatMessage[]
): Promise<DetectionResult> {
  const res = await fetch(`${API_BASE}/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: modelId,
      model_response: modelResponse,
      conversation_history: history,
      document_ids: [],
      config: { check_web: true, check_documents: false, check_conversation: true },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `Detection failed: ${res.status}`);
  }
  return res.json() as Promise<DetectionResult>;
}

/** Map a numeric risk_score (0-100) to the frontend RiskLevel string. */
export function scoreToRisk(score: number): "none" | "green" | "amber" | "red" {
  if (score <= 30) return "green";
  if (score <= 65) return "amber";
  return "red";
}
