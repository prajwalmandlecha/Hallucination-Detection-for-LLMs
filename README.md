# 🛡️ AI Hallucination Detection System

> **Detect, flag, and explain LLM hallucinations before users trust them.**

A production-grade system that intercepts AI-generated responses, extracts claims, verifies them against multiple authoritative sources, and presents detailed hallucination risk analysis with source-backed explanations.

---

## 📋 Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Backend — Detection Pipeline](#backend--detection-pipeline)
  - [Pipeline Flow](#pipeline-flow)
  - [Step 1: Parallel Extraction](#step-1-parallel-extraction-ner--claim-extraction)
  - [Step 2: Multi-Source Verification](#step-2-multi-source-verification)
  - [Step 3: NLI-Based Claim Verification](#step-3-nli-based-claim-verification)
  - [Step 4: Risk Score Aggregation](#step-4-risk-score-aggregation)
  - [Step 5: Output Generation](#step-5-output-generation)
  - [API Endpoints](#api-endpoints)
- [Frontend — Multi-Model Chat Interface](#frontend--multi-model-chat-interface)
- [Browser Extension](#browser-extension)
- [Storage Architecture](#storage-architecture)
- [Supported LLM Models](#supported-llm-models)
- [Technical Decisions & Rationale](#technical-decisions--rationale)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)

---

## Overview

Large Language Models (LLMs) frequently generate confident-sounding but factually incorrect responses — a phenomenon known as **hallucination**. This system acts as a **post-generation verification layer** that:

1. **Intercepts** any AI response (via our chat frontend or browser extension)
2. **Extracts** individual factual claims from the response
3. **Verifies** each claim against multiple sources (conversation history, user documents, web search)
4. **Scores** hallucination risk at both claim-level and response-level (0–100)
5. **Displays** results as an overlay with detailed explanations, source links, and warnings

### What Makes This Different?

| Feature | Our System |
|---|---|
| **Multi-source verification** | Checks against conversation history, user documents, AND web search simultaneously |
| **Claim-level granularity** | Every individual claim is scored, not just the entire response |
| **LLM-driven source selection** | The claim extractor intelligently suggests which sources to check per claim |
| **Source attribution** | Every verification result links back to the actual source (URL, document chunk, conversation turn) |
| **Model-agnostic** | Works with any LLM — compare hallucination rates across 10+ free models side-by-side |
| **Dual interface** | Use via browser extension on ChatGPT/Claude/Gemini OR our built-in multi-model chat |
| **100% free LLM access** | All chat models use free-tier APIs (Groq, NVIDIA NIM, OpenRouter, Ollama) |
| **GPU-accelerated** | NLI verification runs on local GPU (CUDA) for fast inference |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        PRESENTATION LAYER                               │
│                                                                         │
│  ┌──────────────────────┐         ┌──────────────────────────────────┐  │
│  │   Browser Extension  │         │   Chat Frontend (Next.js)        │  │
│  │   (Chrome MV3)       │         │   Multi-model comparison (≤3)    │  │
│  │                      │         │                                  │  │
│  │  • ChatGPT overlay   │         │  ┌────────┬────────┬────────┐    │  │
│  │  • Claude overlay    │         │  │Model A │Model B │Model C │    │  │
│  │  • Gemini overlay    │         │  │+ risk  │+ risk  │+ risk  │    │  │
│  │  • Any LLM website   │         │  │overlay │overlay │overlay │    │  │
│  └──────────┬───────────┘         │  └────────┴────────┴────────┘    │  │
│             │                     │  [  Unified Message Input Bar  ] │  │
│             │                     └──────────────┬───────────────────┘  │
│             │                                    │                      │
└─────────────┼────────────────────────────────────┼──────────────────────┘
              │              ┌─────────────────────┘
              ▼              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        BACKEND (FastAPI)                                │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    API Gateway / Router                          │   │
│  │    POST /detect  │  POST /chat  │  POST /documents/upload        │   │
│  └──────────┬───────────────────────────────────────────────────────┘   │
│             │                                                           │
│             ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐        │
│  │              STEP 1: PARALLEL EXTRACTION                    │        │
│  │  ┌─────────────────────┐   ┌──────────────────────────────┐ │        │
│  │  │  NER Extractor      │   │  Claim Extractor (LLM)       │ │        │
│  │  │  (spaCy en_core_    │   │  (Groq Llama 3.3 70B)        │ │        │
│  │  │   web_sm)           │   │  → claims + suggested sources│ │        │
│  │  │  → flat entities    │   │  + search queries + confidence│ │        │
│  │  │  → PostgreSQL       │   │                              │ │        │
│  │  └────────┬────────────┘   └────────────┬─────────────────┘ │        │
│  └───────────┼─────────────────────────────┼───────────────────┘        │
│              ▼                             ▼                            │
│       ┌─────────────┐           ┌─────────────────┐                     │
│       │ PostgreSQL  │           │  Claims[] with  │                     │
│       │ (entities)  │           │  source hints & │                     │
│       └─────────────┘           │  probabilities  │                     │
│                                 └────────┬────────┘                     │
│                                          ▼                              │
│  ┌─────────────────────────────────────────────────────────────┐        │
│  │        STEP 2: MULTI-SOURCE VERIFICATION (Parallel)         │        │
│  │               (per claim, all sources in parallel)          │        │
│  │                                                             │        │
│  │  ┌──────────────────┐ ┌────────────────┐ ┌───────────────┐  │        │
│  │  │ Conversation     │ │ Vector DB      │ │ Web Search    │  │        │
│  │  │ History          │ │ (User Docs)    │ │ (Tavily API)  │  │        │
│  │  │                  │ │                │ │               │  │        │
│  │  │ Match NER        │ │ Semantic       │ │ Search web,   │  │        │
│  │  │ entities from    │ │ search on      │ │ return        │  │        │
│  │  │ PostgreSQL to    │ │ pgvector for   │ │ snippets +    │  │        │
│  │  │ find relevant    │ │ relevant       │ │ SOURCE URLs   │  │        │
│  │  │ prior messages   │ │ doc chunks     │ │               │  │        │
│  │  └──────┬───────────┘ └──────┬─────────┘ └──────┬────────┘  │        │
│  └─────────┼────────────────────┼──────────────────┼───────────┘        │
│            └──────────┬─────────┘──────────────────┘                    │
│                       ▼                                                 │
│  ┌─────────────────────────────────────────────────────────────┐        │
│  │        STEP 3: NLI VERIFICATION (DeBERTa-v3-base on GPU)    │        │
│  │        For each (claim, evidence) pair → ENTAIL/CONTRA/NEU  │        │
│  │        Batched inference on CUDA via run_in_executor         │        │
│  └────────────────────────┬────────────────────────────────────┘        │
│                           ▼                                             │
│  ┌─────────────────────────────────────────────────────────────┐        │
│  │        STEP 4: RISK SCORE AGGREGATION                       │        │
│  │        Per-claim scores → Weighted overall score (0-100)    │        │
│  └────────────────────────┬────────────────────────────────────┘        │
│                           ▼                                             │
│  ┌─────────────────────────────────────────────────────────────┐        │
│  │        STEP 5: OUTPUT GENERATION                            │        │
│  │        Risk score + claim details + warnings + source links │        │
│  └─────────────────────────────────────────────────────────────┘        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        STORAGE LAYER                                    │
│                                                                         │
│  ┌──────────────────────────────┐  ┌────────────────────────────────┐   │
│  │  PostgreSQL                  │  │  pgvector (extension)          │   │
│  │  (Core relational)          │  │  (Document embeddings)         │   │
│  │                              │  │                                │   │
│  │  • conversations             │  │  • document_chunks.embedding   │   │
│  │  • messages                  │  │    (768d nomic-embed-text)     │   │
│  │  • documents                 │  │  • L2 distance similarity     │   │
│  │  • document_chunks           │  │    search                     │   │
│  │  • extracted_entities (NER)  │  │                                │   │
│  └──────────────────────────────┘  └────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Features

### 🔍 Core Detection Engine
- **LLM-powered claim extraction** — Uses Groq Llama 3.3 70B to decompose AI responses into individual verifiable claims with type classification and per-claim source suggestions
- **Smart source selection** — LLM dynamically recommends which sources (web, documents, conversation) to check per claim; config booleans act as opt-out overrides only
- **Multi-source parallel verification** — Checks each claim against conversation history, user-uploaded documents, and live web search simultaneously
- **NLI-based semantic verification** — DeBERTa-v3-base cross-encoder on GPU classifies each (claim, evidence) pair as entailment / contradiction / neutral
- **Weighted risk score aggregation** — Combines multiple signals (source support, contradictions, coverage, importance, agreement) into a 0–100 score
- **Source-attributed explanations** — Every flagged claim links back to the actual source URL, document chunk, or conversation turn

### 💬 Multi-Model Chat Interface
- **Compare up to 3 LLMs side-by-side** — Send one message, get responses from multiple models simultaneously
- **10+ free models** — Groq, NVIDIA NIM, OpenRouter, and local Ollama — no paid API keys required
- **Dynamic layout** — Chat window automatically adjusts from 1 to 2 to 3 columns based on selected models
- **Per-model analysis** — Each response independently analyzed for hallucinations in parallel
- **Streaming** — Real-time SSE streaming for all model responses
- **Document upload** — Upload reference documents that become part of the verification knowledge base

### 🧩 Browser Extension
- **Works on ChatGPT, Claude, Gemini** — Content script detects AI response bubbles on LLM chat websites
- **Non-intrusive overlay** — Small risk badge on each response; click to expand full analysis panel
- **Same backend** — Extension calls the exact same `/detect` API endpoint as the chat frontend

### 📊 Analysis Display
- **Risk score gauge** (0–100) with color-coded severity (green → amber → orange → red)
- **Warning banner** with contextual messages for risky responses
- **Claim-by-claim breakdown** showing verification status, evidence, and source links
- **Inline response highlighting** — Risky claims highlighted directly in the AI response text
- **Source panel** — Clickable links to web sources, document chunks, and conversation references

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Backend** | Python 3.13 + FastAPI | Async-first, high performance, native Python ML ecosystem |
| **Frontend** | Next.js (React) + TypeScript | Component-based, SSR, great DX |
| **Extension** | Chrome Manifest V3 | Modern extension standard, vanilla JS |
| **Database** | PostgreSQL 16 | Battle-tested, extensible with pgvector |
| **Vector Store** | pgvector (PostgreSQL extension) | No separate infra, L2 distance, hybrid queries |
| **NLI Model** | DeBERTa-v3-base (cross-encoder) | 92.38% SNLI accuracy, GPU-accelerated (CUDA 12.4) |
| **Claim Extraction** | Llama 3.3 70B (via Groq) | Ultra-fast inference, excellent JSON output, free tier |
| **NER** | spaCy (en_core_web_sm) | Fast, accurate entity extraction |
| **Embeddings** | nomic-embed-text (via Ollama) | Local, free, 768d vectors |
| **Web Search** | Tavily API | AI-native, returns source URLs + clean text, RAG-optimized |
| **Chat LLMs** | Groq / NVIDIA NIM / OpenRouter / Ollama | All free-tier — no paid API keys needed |
| **Containerization** | Docker + Docker Compose + NVIDIA Container Toolkit | GPU passthrough, reproducible deployment |

---

## Backend — Detection Pipeline

### Pipeline Flow

```
Request arrives at POST /detect
│
├── STEP 1 (PARALLEL):
│   ├── NER Extraction (spaCy) → flat entities → PostgreSQL (incremental)
│   └── Claim Extraction (Groq Llama 3.3 70B) → claims[] + suggested_sources + search_queries
│
│   ⏳ Wait for both to complete
│
├── STEP 2 (PARALLEL, per claim):
│   ├── Conversation history — always checked if history exists (NER entity match)
│   ├── Vector DB (pgvector) — always checked if document_ids provided
│   └── Web search (Tavily) — checked if LLM suggests it for this claim
│   (config booleans are opt-out overrides, NOT opt-in gates)
│
│   ⏳ Wait for all evidence to be retrieved
│
├── STEP 3: NLI Verification (GPU)
│   └── Batch all (claim, evidence) pairs → DeBERTa-v3-base on CUDA → scores
│
├── STEP 4: Risk Score Aggregation
│   └── Per-claim scores → weighted overall score
│
└── STEP 5: Output Generation
    └── Risk score + claim details + warnings + source links → response
```

### Step 1: Parallel Extraction (NER + Claim Extraction)

When a request arrives, two operations run **in parallel**:

#### 1A. NER Extraction (spaCy)
- Extract named entities from conversation messages using `en_core_web_sm`
- **Entity types**: PERSON, ORG, GPE, DATE, CARDINAL, EVENT, PRODUCT, etc.
- **Incremental processing**: Tracks `last_processed_index` — only runs spaCy on new messages, not the full conversation history
- **Storage**: Each entity stored as a flat row in PostgreSQL's `extracted_entities` table, linked to its source `conversation_id`
- **Duplicates**: If "Einstein" appears in messages #1, #3, and #5 → 3 separate rows, each linked to its source message. The verifier finds all matches and NLI picks the best evidence.

#### 1B. Claim Extraction (LLM-Powered)
Send the AI response + conversation context to **Groq Llama 3.3 70B** with a structured prompt:

```json
{
  "claims": [
    {
      "id": "c1",
      "text": "The Eiffel Tower was built in 1889",
      "type": "factual",
      "importance": 0.8,
      "suggested_sources": ["web_search", "conversation_history"],
      "search_queries": ["Eiffel Tower construction year"],
      "confidence_needs_checking": 0.7,
      "key_entities": ["Eiffel Tower", "1889"]
    }
  ]
}
```

The LLM intelligently decides which sources to check per claim — factual claims get `web_search`, contextual claims get `conversation_history`, document-referenced claims get `vector_db`.

Claims with `confidence_needs_checking` below a configurable threshold (default: 0.3) are skipped to reduce latency.

**Why Groq Llama 3.3 70B?** Ultra-fast LPU inference (~200-500ms), excellent JSON instruction-following, free tier (30 RPM, 14400 RPD). Smart enough to properly decompose complex responses into atomic claims.

### Step 2: Multi-Source Verification

Each claim is verified against applicable sources **in parallel**. Source selection is **LLM-driven** — the claim extractor's `suggested_sources` field decides which sources to check. Config booleans (`check_web`, `check_documents`, `check_conversation`) only serve as **opt-out overrides**.

| Source | When Checked | What It Returns |
|---|---|---|
| **Conversation History** | Always (if history + NER entities exist, unless user disables) | Matching messages containing the same NER entities as the claim |
| **Vector DB (User Docs)** | Always (if `document_ids` provided, unless user disables) | Semantically similar document chunks via pgvector L2 distance |
| **Web Search (Tavily)** | When LLM's `suggested_sources` includes `web_search` AND Tavily key available | Search snippets + **source URLs** + page titles |

#### Source Attribution Rules
Every piece of evidence includes a traceable source reference:
- **Web Search**: Full URL (e.g., `https://en.wikipedia.org/wiki/Eiffel_Tower`), page title, relevant snippet
- **User Documents**: Document name, chunk text, chunk position within document
- **Conversation History**: Message index, speaker (user/AI), relevant excerpted text

### Step 3: NLI-Based Claim Verification

For each `(claim, evidence)` pair retrieved from the sources, run through the **NLI cross-encoder model** on GPU:

| NLI Output | Meaning | Impact |
|---|---|---|
| **ENTAILMENT** (score 0–1) | Evidence supports the claim | ✅ Reduces risk score |
| **CONTRADICTION** (score 0–1) | Evidence contradicts the claim | ❌ Increases risk score significantly |
| **NEUTRAL** (score 0–1) | Evidence is inconclusive | ⚠️ Slightly increases risk score |

**Model: `cross-encoder/nli-deberta-v3-base`**

| Property | Value |
|---|---|
| Architecture | DeBERTa-v3-base (86M params) |
| SNLI Accuracy | 92.38% |
| MNLI Accuracy | 90.04% |
| Device | CUDA (RTX 4050, 6GB VRAM) |
| PyTorch | 2.6.0+cu124 |
| VRAM Usage | ~400 MB |

**Non-Blocking GPU Inference in FastAPI:**

- Model inference runs via `asyncio.run_in_executor()` → offloads to thread pool → event loop stays free
- GPU operations release the Python GIL during CUDA compute, allowing other async tasks to proceed
- All (claim, evidence) pairs per request batched into a single forward pass for efficiency

### Step 4: Risk Score Aggregation

#### Per-Claim Risk Score (0–100)

```python
claim_risk = (
    w1 * (1 - max_entailment_score)      +   # Source support         (weight: 0.30)
    w2 * max_contradiction_score          +   # Direct contradictions  (weight: 0.30)
    w3 * (1 - source_coverage_ratio)      +   # How many sources found (weight: 0.15)
    w4 * claim_importance                 +   # Claim criticality      (weight: 0.10)
    w5 * source_agreement_variance        +   # Source disagreement    (weight: 0.10)
    w6 * (1 - evidence_count_norm)            # Amount of evidence     (weight: 0.05)
) * 100
```

#### Overall Response Risk Score (0–100)

```python
# Weighted average — important claims weigh more
response_risk = weighted_average(
    values  = [claim.risk_score for claim in claims],
    weights = [claim.importance for claim in claims]
)

# Hard floor: if any claim has a strong contradiction, minimum score is 70
if any(claim.contradiction_score > 0.9 for claim in claims):
    response_risk = max(response_risk, 70)

# Boost if many claims are unverifiable
unverifiable_ratio = count(c for c in claims if c.source_coverage == 0) / len(claims)
if unverifiable_ratio > 0.5:
    response_risk = max(response_risk, 60)
```

#### Risk Levels

| Score | Level | Color | Default Warning Message |
|---|---|---|---|
| 0–25 | LOW | 🟢 Green | "Response appears well-grounded" |
| 26–50 | MODERATE | 🟡 Amber | "Some claims could not be fully verified" |
| 51–75 | HIGH | 🟠 Orange | "Multiple unverified or questionable claims detected" |
| 76–100 | CRITICAL | 🔴 Red | "Response contains likely hallucinated content" |

### Step 5: Output Generation

#### Warning Messages
Generated contextually based on specific claim verification results:

| Trigger | Warning Message |
|---|---|
| No evidence found for a claim | "No verifiable source found for: `{claim_text}`" |
| Evidence contradicts a claim | "Contradicts information from: `{source_reference}`" |
| Contradicts user's document | "Conflicts with your uploaded document: `{doc_name}`" |
| Contradicts conversation history | "Contradicts earlier conversation context (message #{n})" |
| Statistical claim unverified | "Statistical claim could not be verified: `{claim_text}`" |
| Sources disagree | "Sources disagree on: `{claim_text}` — check linked sources" |

#### Full Response Schema

```json
{
  "response_id": "uuid",
  "overall_risk_score": 72,
  "risk_level": "HIGH",
  "risk_color": "#F97316",
  "warning_message": "Multiple unverified or questionable claims detected",
  "warnings": [
    {
      "type": "no_source",
      "message": "No verifiable source found for: 'The mortality rate decreased by 47%'",
      "claim_id": "c3"
    },
    {
      "type": "contradiction",
      "message": "Contradicts information from: https://who.int/...",
      "claim_id": "c5",
      "source_url": "https://who.int/..."
    }
  ],
  "claims": [
    {
      "id": "c1",
      "text": "The Eiffel Tower was built in 1889",
      "type": "factual",
      "risk_score": 8,
      "status": "VERIFIED",
      "suggested_sources": ["web_search", "conversation_history"],
      "verification_details": {
        "entailment_score": 0.96,
        "contradiction_score": 0.01,
        "sources_checked": ["web_search", "conversation_history"],
        "evidence": [
          {
            "source_type": "web_search",
            "source_url": "https://en.wikipedia.org/wiki/Eiffel_Tower",
            "source_title": "Eiffel Tower - Wikipedia",
            "snippet": "Construction began on 28 January 1887 and was finished on 15 March 1889.",
            "nli_label": "ENTAILMENT",
            "nli_scores": { "entailment": 0.96, "contradiction": 0.01, "neutral": 0.03 }
          }
        ]
      }
    }
  ],
  "metadata": {
    "processing_time_ms": 1840,
    "claims_extracted": 7,
    "claims_verified": 5,
    "claims_skipped": 2,
    "sources_queried": ["conversation_history", "vector_db", "web_search"]
  }
}
```

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/v1/models` | List all available LLM models |
| `POST` | `/api/v1/detect` | Main hallucination detection — accepts AI response + context, returns full analysis |
| `POST` | `/api/v1/chat` | Proxy to LLM APIs — forwards user message to selected model, supports SSE streaming |
| `POST` | `/api/v1/documents/upload` | Upload document → chunk → embed (nomic-embed-text via Ollama) → store in pgvector |
| `GET` | `/api/v1/documents/{id}` | Get document metadata |
| `DELETE` | `/api/v1/documents/{id}` | Delete document and its embeddings |
| `POST` | `/api/v1/conversations` | Create a new conversation context |
| `GET` | `/api/v1/conversations/{id}` | Get conversation with messages |
| `POST` | `/api/v1/conversations/{id}/messages` | Add messages to a conversation |

#### `POST /api/v1/detect` — Request

```json
{
  "conversation_id": "uuid",
  "model_id": "llama-3.3-70b-versatile",
  "model_response": "The Eiffel Tower was built in 1889 by Gustave Eiffel...",
  "conversation_history": [
    { "role": "user", "content": "Tell me about the Eiffel Tower" },
    { "role": "assistant", "content": "The Eiffel Tower was built in 1889..." }
  ],
  "document_ids": ["doc-uuid-1"],
  "config": {
    "check_web": true,
    "check_documents": true,
    "check_conversation": true,
    "claim_threshold": 0.3
  }
}
```

> **Note:** Config booleans are **opt-out overrides**. Set to `false` to force-disable a source. When `true` (default), the LLM's per-claim `suggested_sources` drives which sources are actually queried.

#### `POST /api/v1/chat` — Request

```json
{
  "conversation_id": "uuid",
  "model_id": "llama-3.3-70b-versatile",
  "message": "Tell me about the Eiffel Tower",
  "conversation_history": [],
  "stream": true
}
```

---

## Frontend — Multi-Model Chat Interface

### Layout & Functionality

The chat frontend is built with **Next.js (React + TypeScript)**, featuring a dynamic multi-model comparison view:

```
┌─────────────────────────────────────────────────────────┐
│  🛡️ AI Hallucination Detector         [Upload Doc] [⚙] │
├───────────────────┬───────────────────┬─────────────────┤
│ ▼ Llama 3.3 70B   │ ▼ Mistral 7B      │ ▼ Gemma 2 9B    │
│   (Groq)          │   (NVIDIA)        │   (Groq)        │
│                   │                   │                 │
│ User: Tell me...  │ User: Tell me...  │ User: Tell me...│
│                   │                   │                 │
│ AI: The Eiffel... │ AI: Built in...   │ AI: The iconic..│
│ ┌──────────────┐  │ ┌──────────────┐  │ ┌─────────────┐│
│ │ Risk: 23 🟢  │  │ │ Risk: 45 🟡  │  │ │ Risk: 71 🟠 ││
│ │ 5/5 verified │  │ │ 3/5 verified │  │ │ 2/6 verified││
│ │ [Details ▼]  │  │ │ [Details ▼]  │  │ │ [Details ▼] ││
│ └──────────────┘  │ └──────────────┘  │ └─────────────┘│
│                   │                   │                 │
├───────────────────┴───────────────────┴─────────────────┤
│ [📎] Type your message...                     [Send ➤] │
│ [+ Add Model]                     [Models: 3/3]         │
└─────────────────────────────────────────────────────────┘
```

### Key Behaviors

| Feature | Implementation |
|---|---|
| **Dynamic columns** | 1 model = full width, 2 models = 50/50, 3 models = 33/33/33. CSS Grid with smooth transitions |
| **Model selector** | Dropdown in each column header with all 10+ free models |
| **Parallel detection** | After each model responds, frontend calls `POST /detect` for each response independently |
| **Hallucination overlay** | Expandable panel below each AI response showing: risk gauge, claim cards, source links, warnings |
| **Document upload** | Upload PDFs/docs → backend chunks + embeds → `document_ids` included in all future `/detect` calls |
| **Streaming** | Model responses stream in real-time via SSE; detection runs after stream completes |

---

## Browser Extension

### Architecture (Chrome Manifest V3)

```
extension/
├── manifest.json        # Permissions, content scripts, background service worker
├── content.js           # Injected into ChatGPT/Claude/Gemini pages
├── background.js        # Service worker for API calls
├── popup.html           # Extension popup UI (settings, status)
├── popup.js             # Popup logic
├── overlay.js           # Risk badge + floating analysis panel
└── styles.css           # Overlay styling
```

### How It Works

1. **Content script** detects AI response elements on supported LLM websites using DOM observers
2. When a new AI response appears, content script extracts the response text + conversation history
3. Background worker calls `POST /api/v1/detect` with the response and context
4. Content script renders a **risk badge** (🟢🟡🟠🔴) overlaid on the AI response
5. Click to expand full analysis panel with claim breakdown, warnings, and source links

---

## Storage Architecture

### Single PostgreSQL Instance with pgvector

We use **one PostgreSQL 16 database** with the `pgvector` extension, avoiding the complexity of separate database systems:

#### Core Tables (PostgreSQL)

```sql
-- Conversations & Messages
CREATE TABLE conversations (
    id UUID PRIMARY KEY,
    title VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE messages (
    id UUID PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(id),
    role VARCHAR(20) NOT NULL,  -- 'user' or 'assistant'
    content TEXT NOT NULL,
    model_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Documents (user uploads)
CREATE TABLE documents (
    id UUID PRIMARY KEY,
    filename VARCHAR(500),
    content_type VARCHAR(100),
    uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE document_chunks (
    id UUID PRIMARY KEY,
    document_id UUID REFERENCES documents(id),
    chunk_index INTEGER,
    text_content TEXT NOT NULL,
    embedding vector(768),      -- pgvector: nomic-embed-text produces 768d
    created_at TIMESTAMP DEFAULT NOW()
);

-- NER Entities (flat, per-conversation)
CREATE TABLE extracted_entities (
    id UUID PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(id),
    name VARCHAR(255) NOT NULL,
    label VARCHAR(100) NOT NULL,  -- PERSON, ORG, GPE, DATE, etc.
    source_message_id UUID REFERENCES messages(id),
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### Vector Search (pgvector)

```sql
-- Enable extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Semantic search: find document chunks similar to a claim
SELECT id, text_content, document_id
FROM document_chunks
WHERE document_id IN ($document_ids)
ORDER BY embedding <-> $query_embedding  -- L2 distance
LIMIT 3;
```

**Why pgvector over FAISS/ChromaDB?**
- **Same database** — no additional infrastructure to deploy/manage
- **Hybrid queries** — combine vector similarity with relational filters in a single SQL query
- **Concurrent performance** — outperforms ChromaDB under concurrent load
- **Scales** — handles 10–100M vectors before needing specialized solutions

---

## Supported LLM Models

All models use **free-tier APIs** — no paid keys required:

| Tier | Model | Provider | Free Limits |
|---|---|---|---|
| 🥇 **Tier 1** | Llama 3.3 70B | Groq | 30 RPM, 14400 RPD |
| 🥇 **Tier 1** | Llama 3.1 70B | NVIDIA NIM | 1000 free credits |
| 🥇 **Tier 1** | Llama 3.3 70B | OpenRouter | 20 RPM, 50 daily |
| 🥇 **Tier 1** | Nemotron 70B | OpenRouter | 20 RPM, 50 daily |
| 🥈 **Tier 2** | Llama 3.1 8B | Groq | 30 RPM, ultra-fast |
| 🥈 **Tier 2** | Gemma 2 9B | Groq | 30 RPM |
| 🥈 **Tier 2** | Mistral 7B | NVIDIA NIM | 1000 free credits |
| 🥈 **Tier 2** | Gemini 2.5 Flash | OpenRouter | 20 RPM |
| 🥉 **Tier 3** | Llama 3.1 8B | Ollama (local) | Unlimited, no internet |

Users can select up to 3 models in the comparison view. The system sends the same message to all selected models, gets their responses, and runs independent hallucination detection on each — revealing which models hallucinate more on the same query.

---

## Project Structure

```
AI_HallicunationDetectionSystem/
│
├── README.md
├── docker-compose.yml               # PostgreSQL + Backend
│
├── backend/                         # FastAPI backend
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                  # FastAPI app, startup events, middleware
│   │   ├── config.py                # Environment config, API keys, model registry
│   │   │
│   │   ├── api/                     # Route handlers
│   │   │   ├── __init__.py
│   │   │   ├── detect.py            # POST /detect — main hallucination detection
│   │   │   ├── chat.py              # POST /chat — LLM proxy with SSE streaming
│   │   │   ├── documents.py         # Document upload, retrieval, deletion
│   │   │   └── conversations.py     # Conversation CRUD + message management
│   │   │
│   │   ├── core/                    # Core detection pipeline
│   │   │   ├── __init__.py
│   │   │   ├── claim_extractor.py   # LLM-powered claim extraction (Groq Llama 3.3 70B)
│   │   │   ├── ner_extractor.py     # Named entity recognition (spaCy en_core_web_sm)
│   │   │   ├── verifier.py          # Multi-source verification orchestrator
│   │   │   ├── nli_model.py         # DeBERTa NLI model wrapper + CUDA inference
│   │   │   ├── risk_scorer.py       # Per-claim + overall risk score + warnings
│   │   │   ├── web_search.py        # Tavily API integration
│   │   │   ├── vector_db.py         # pgvector semantic search
│   │   │   ├── embeddings.py        # Ollama nomic-embed-text client
│   │   │   └── document_processor.py # Document chunking pipeline
│   │   │
│   │   ├── models/                  # Pydantic schemas
│   │   │   ├── __init__.py
│   │   │   ├── detect.py            # DetectionRequest/Response, ClaimResult, EvidencePiece
│   │   │   ├── chat.py              # ChatRequest, ChatResponse
│   │   │   ├── documents.py         # DocumentResponse
│   │   │   └── conversations.py     # ConversationCreate, MessageAdd
│   │   │
│   │   ├── db/                      # Database layer
│   │   │   ├── __init__.py
│   │   │   ├── engine.py            # SQLAlchemy async engine + session factory
│   │   │   └── models.py            # SQLAlchemy ORM models (all tables)
│   │   │
│   │   └── utils/                   # Helpers
│   │       └── __init__.py
│   │
│   ├── tests/                       # Test suite
│   │   └── run_tests.ps1            # PowerShell API test suite (31 tests)
│   │
│   ├── alembic/                     # Database migrations
│   ├── requirements.txt
│   ├── Dockerfile                   # NVIDIA CUDA 12.4 + Python 3.13
│   ├── .dockerignore
│   └── .env.example
│
├── frontend/                        # Next.js chat frontend
│
└── extension/                       # Chrome browser extension
```

---

## Getting Started

### Prerequisites

- **Python 3.13+**
- **Docker & Docker Compose** (for PostgreSQL)
- **NVIDIA GPU** with driver ≥ 556.12 (for CUDA 12.4 NLI inference)
- **NVIDIA Container Toolkit** (for GPU passthrough in Docker)
- **Ollama** (for local embedding model)
- **API Keys** (all free):
  - **Groq** — `console.groq.com` (claim extraction + chat)
  - **Tavily** — `tavily.com` (web search)
  - **NVIDIA NIM** — `build.nvidia.com` (chat)
  - **OpenRouter** — `openrouter.ai` (chat)

### Quick Start

```bash
# 1. Clone the repository
git clone <repo-url>
cd AI_HallicunationDetectionSystem

# 2. Start infrastructure (PostgreSQL)
docker compose up -d postgres

# 3. Pull the embedding model via Ollama
ollama pull nomic-embed-text

# 4. Backend setup
cd backend
python -m venv venv
venv\Scripts\activate            # Windows
# source venv/bin/activate       # Linux/Mac

# Install PyTorch with CUDA support
pip install torch==2.6.0 --index-url https://download.pytorch.org/whl/cu124

# Install remaining dependencies
pip install -r requirements.txt
python -m spacy download en_core_web_sm

# 5. Configure environment
cp .env.example .env
# Edit .env with your free API keys (Groq, Tavily, NVIDIA, OpenRouter)

# 6. Run database migrations
alembic upgrade head

# 7. Start backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# API docs at http://localhost:8000/docs
```

### Docker (Full Stack with GPU)

```bash
# Build and start everything (PostgreSQL + Backend with GPU)
docker compose up --build

# Backend will be at http://localhost:8000
# Requires NVIDIA Container Toolkit for GPU passthrough
```

### Environment Variables

```env
# Groq (claim extraction + chat)
GROQ_API_KEY=your_groq_api_key

# NVIDIA NIM (chat)
NVIDIA_API_KEY=your_nvidia_api_key

# OpenRouter (chat)
OPENROUTER_API_KEY=your_openrouter_api_key

# Tavily (web search)
TAVILY_API_KEY=your_tavily_api_key
```

### Running Tests

```powershell
cd backend\tests
.\run_tests.ps1
```

---