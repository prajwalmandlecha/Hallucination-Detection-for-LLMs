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

export interface Warning {
  type: string;
  message: string;
  claim_id: string;
  source_url?: string | null;
}

export interface VerificationDetails {
  entailment_score?: number;
  contradiction_score?: number;
  neutral_score?: number;
  source_coverage?: number;
  source_agreement_variance?: number;
  evidence?: Array<{
    source_type: string;
    source_tier?: string;
    source_url?: string | null;
    source_title?: string | null;
    document_name?: string | null;
    chunk_index?: number | null;
    message_index?: number | null;
    snippet?: string;
    nli_label?: string;
    nli_scores?: Record<string, number> | null;
  }>;
  sources_checked?: string[];
}

export interface DetectionClaim {
  id: string;
  text: string;
  exact_quote?: string;
  domain: string;
  risk_score: number;
  status: "VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED" | "CONTRADICTED" | "UNVERIFIABLE_SOURCE" | "OPINION" | "SKIPPED";
  confidence: number;
  reasoning?: string;
  suggestion?: string;
  suggested_sources: string[];
  note: string;
  citations: string[];
  verification_details?: VerificationDetails;
}

export interface DetectionMetadata {
  processing_time_ms: number;
  claims_extracted: number;
  claims_verified: number;
  claims_skipped: number;
  sources_queried: string[];
  platform?: string | null;
  conversation_id?: string | null;
}

export interface HighlightClaim {
  text: string;
  exact_quote?: string;
  domain?: string;
  score: number;
  note?: string;
  citations?: string[];
}

export interface MessageDetectionResult {
  messageId?: string;
  messageIndex?: number;
  assistantRoleIndex?: number;
  role: string;
  risk_score: number;
  risk_level: string;
  claims: HighlightClaim[];
}

export interface DetectionResult {
  response_id: string;
  overall_risk_score: number;
  risk_level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  risk_color: string;
  warning_message: string;
  warnings: Warning[];
  claims: DetectionClaim[];
  results?: MessageDetectionResult[] | null;
  metadata?: DetectionMetadata;
}

// ---- Detection Request Models ----

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  model_id?: string;
}

export interface DetectionConfig {
  check_web?: boolean;
  check_documents?: boolean;
  check_conversation?: boolean;
  claim_threshold?: number;
}

export interface DetectionRequest {
  conversation_id?: string;
  document_ids?: string[];
  config?: DetectionConfig;
  model_id?: string;
  model_response?: string;
  conversation_history?: ConversationMessage[];
}

export interface Conversation {
  id: string;
  external_id?: string;
  platform?: string;
  title?: string;
  external_url?: string;
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

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/conversations/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`Failed to delete conversation (${res.status})`);
  }
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

/** Fetch all available models from the backend. (MOCKED) */
export async function fetchModels(): Promise<BackendModel[]> {
  const res = await fetch(`${API_BASE}/models`);
  if (!res.ok) throw new Error("Failed to fetch models");
  const data = await res.json();
  const modelsList = Array.isArray(data) ? data : data.models || [];
  return modelsList.map((m: any) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    tier: m.tier,
    available: true,
    free: true,
    description: m.description,
  }));
}

// ---- Document API ---- //

export interface DocumentResponse {
  id: string;
  conversation_id?: string;
  filename: string;
  file_type: string;
  file_size_bytes: number;
  chunk_count: number;
  created_at: string;
}

export async function uploadDocument(file: File, conversationId?: string): Promise<DocumentResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (conversationId) formData.append("conversation_id", conversationId);
  
  const res = await fetch(`${API_BASE}/documents/upload`, {
    method: "POST",
    body: formData
  });
  if (!res.ok) throw new Error("Failed to upload document");
  return res.json();
}

export async function getDocument(docId: string): Promise<DocumentResponse> {
  const res = await fetch(`${API_BASE}/documents/${docId}`);
  if (!res.ok) throw new Error("Failed to get document");
  return res.json();
}

export async function getGlobalDocuments(): Promise<DocumentResponse[]> {
  const res = await fetch(`${API_BASE}/documents?global_only=true`);
  if (!res.ok) throw new Error("Failed to fetch global documents");
  const data = await res.json();
  return data.documents;
}

export async function deleteDocument(docId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${docId}`, {
    method: "DELETE"
  });
  if (!res.ok) throw new Error("Failed to delete document");
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

/** Streaming chat message */
export async function sendChatMessageStream(
  modelId: string,
  message: string,
  history: ChatMessage[],
  onChunk: (chunk: string) => void
): Promise<string> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: modelId,
      message,
      conversation_history: history,
      stream: true,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `Chat failed: ${res.status}`);
  }
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const eventStr = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      
      if (eventStr.startsWith("data: ")) {
        const data = eventStr.slice(6);
        if (data.trim() === "[DONE]") {
          return fullText;
        } else if (data.startsWith("[ERROR]")) {
          throw new Error(data);
        } else {
          fullText += data;
          onChunk(data);
        }
      }
      
      boundary = buffer.indexOf("\n\n");
    }
  }
  return fullText;
}

/** Run hallucination detection on an AI response. */
export async function detectHallucinations(
  modelId: string,
  modelResponse: string,
  history: ChatMessage[],
  documentIds: string[] = []
): Promise<DetectionResult> {
  const res = await fetch(`${API_BASE}/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: modelId,
      model_response: modelResponse,
      conversation_history: history,
      document_ids: documentIds,
      config: { check_web: true, check_documents: true, check_conversation: true },
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
