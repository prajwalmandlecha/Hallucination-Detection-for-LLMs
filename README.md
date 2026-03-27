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
- [Implementation Phases](#implementation-phases)

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
| **Source attribution** | Every verification result links back to the actual source (URL, document chunk, conversation turn) |
| **Model-agnostic** | Works with any LLM — compare hallucination rates across 5-7+ models side-by-side |
| **Dual interface** | Use via browser extension on ChatGPT/Claude/Gemini OR our built-in multi-model chat |
| **Real-time** | Parallel pipeline architecture for sub-second verification per claim |

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
│  │  │  (spaCy / sm LLM)   │   │  (Gemini 2.0 Flash)          │ │        │
│  │  │  → entities/rels    │   │  → claims + source hints     │ │        │
│  │  └────────┬────────────┘   └────────────┬─────────────────┘ │        │
│  └───────────┼─────────────────────────────┼───────────────────┘        │
│              ▼                             ▼                            │
│       ┌──────────┐              ┌─────────────────┐                     │
│       │  Redis   │              │  Claims[] with  │                     │
│       │  (Cache) │              │  source hints & │                     │
│       └──────────┘              │  probabilities  │                     │
│                                 └────────┬────────┘                     │
│                                          ▼                              │
│  ┌─────────────────────────────────────────────────────────────┐        │
│  │              STEP 2: MULTI-SOURCE VERIFICATION (Parallel)   │        │
│  │                     (per claim, all sources in parallel)    │        │
│  │                                                             │        │
│  │  ┌──────────────────┐ ┌────────────────┐ ┌───────────────┐  │        │
│  │  │ Conversation     │ │ Vector DB      │ │ Web Search    │  │        │
│  │  │ History          │ │ (User Docs)    │ │ (Tavily API)  │  │        │
│  │  │                  │ │                │ │               │  │        │
│  │  │ Query entity     │ │ Semantic       │ │ Search web,   │  │        │
│  │  │ graph (AGE)      │ │ search on      │ │ return        │  │        │
│  │  │ for relevant     │ │ pgvector for   │ │ snippets +    │  │        │
│  │  │ entities/rels    │ │ relevant       │ │ SOURCE URLs   │  │        │
│  │  │                  │ │ doc chunks     │ │               │  │        │
│  │  └──────┬───────────┘ └──────┬─────────┘ └──────┬────────┘  │        │
│  └─────────┼────────────────────┼──────────────────┼───────────┘        │
│            └──────────┬─────────┘──────────────────┘                    │
│                       ▼                                                 │
│  ┌─────────────────────────────────────────────────────────────┐        │
│  │        STEP 3: NLI VERIFICATION (DeBERTa-v3-base)           │        │
│  │        For each (claim, evidence) pair → ENTAIL/CONTRA/NEU  │        │
│  │        Batched inference on GPU via run_in_executor         │        │
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
│  ┌──────────────────────┐  ┌────────────────┐  ┌────────────────────┐   │
│  │  PostgreSQL          │  │  pgvector      │  │  Apache AGE        │   │
│  │  (Core relational)   │  │  (Embeddings)  │  │  (Entity Graph)    │   │
│  │                      │  │                │  │                    │   │
│  │  • users             │  │  • document    │  │  • NER entities    │   │
│  │  • conversations     │  │    chunk       │  │  • relationships   │   │
│  │  • messages          │  │    embeddings  │  │  • per-conversation│   │
│  │  • documents         │  │  • HNSW index  │  │    graphs          │   │
│  │  • analysis_results  │  │                │  │                    │   │
│  │  • claim_results     │  │                │  │                    │   │
│  └──────────────────────┘  └────────────────┘  └────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────┐                                    │
│  │  Redis                          │                                    │
│  │  • NER cache (per conversation, │                                    │
│  │     invalidate on new messages) │                                    │
│  │  • Session state                │                                    │
│  │  • Rate limiting                │                                    │
│  └─────────────────────────────────┘                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Features

### 🔍 Core Detection Engine
- **LLM-powered claim extraction** — Uses Gemini 2.0 Flash to decompose AI responses into individual verifiable claims with type classification and source suggestions
- **Multi-source parallel verification** — Checks each claim against conversation history, user-uploaded documents, and live web search simultaneously
- **NLI-based semantic verification** — DeBERTa-v3-base cross-encoder classifies each (claim, evidence) pair as entailment / contradiction / neutral
- **Weighted risk score aggregation** — Combines multiple signals (source support, contradictions, coverage, importance, agreement) into a 0–100 score
- **Source-attributed explanations** — Every flagged claim links back to the actual source URL, document chunk, or conversation turn

### 💬 Multi-Model Chat Interface
- **Compare up to 3 LLMs side-by-side** — Send one message, get responses from multiple models simultaneously
- **Dynamic layout** — Chat window automatically adjusts from 1 to 2 to 3 columns based on selected models
- **Per-model analysis** — Each response independently analyzed for hallucinations in parallel
- **Model switching** — Change any model mid-conversation via dropdown in each column header
- **Unified input** — Type once, send to all; conversation history maintained per-model
- **Document upload** — Upload reference documents that become part of the verification knowledge base

### 🧩 Browser Extension
- **Works on ChatGPT, Claude, Gemini** — Content script detects AI response bubbles on LLM chat websites
- **Non-intrusive overlay** — Small risk badge on each response; click to expand full analysis panel
- **Document capture** — If user uploads documents in the LLM chat, extension captures them for verification
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
| **Backend** | Python + FastAPI | Async-first, high performance, native Python ML ecosystem |
| **Frontend** | Next.js (React) + TypeScript | Component-based, SSR, great DX |
| **Extension** | Chrome Manifest V3 | Modern extension standard, vanilla JS |
| **Database** | PostgreSQL | Battle-tested, extensible with pgvector + AGE |
| **Vector Store** | pgvector (PostgreSQL extension) | No separate infra, HNSW indexing, hybrid queries |
| **Graph Store** | Apache AGE (PostgreSQL extension) | Entity-relationship graphs within PostgreSQL |
| **Cache** | Redis | NER caching, session state, rate limiting |
| **NLI Model** | DeBERTa-v3-base (cross-encoder) | 92.38% SNLI accuracy, ~0.032s/claim, fits in 6GB VRAM |
| **Claim Extraction** | Gemini 2.0 Flash (via API) | Fast, smart structured output, cost-effective |
| **NER** | spaCy (en_core_web_trf) | Fast, accurate entity extraction |
| **Embeddings** | nomic-embed-text (via Ollama) | Local, free, outperforms OpenAI ada-002, 768d |
| **Web Search** | Tavily API | AI-native, returns source URLs + clean text, RAG-optimized |
| **Containerization** | Docker + Docker Compose | Reproducible local development |

---

## Backend — Detection Pipeline

### Pipeline Flow

```
Request arrives at POST /detect
│
├── STEP 1 (PARALLEL):
│   ├── NER Extraction → entities/relationships → cache in Redis
│   └── Claim Extraction (Gemini 2.0 Flash) → claims[] + source suggestions
│
│   ⏳ Wait for both to complete
│
├── STEP 2 (PARALLEL, per claim, per source):
│   ├── Query conversation history (entity graph via Apache AGE)
│   ├── Query vector DB (user documents via pgvector) — only if document_ids present
│   └── Query web search (Tavily API) — only if claim confidence > threshold
│
│   ⏳ Wait for all evidence to be retrieved
│
├── STEP 3: NLI Verification
│   └── Batch all (claim, evidence) pairs → DeBERTa-v3-base → scores
│
├── STEP 4: Risk Score Aggregation
│   └── Per-claim scores → weighted overall score
│
└── STEP 5: Output Generation
    └── Risk score + claim details + warnings + source links → response
```

### Step 1: Parallel Extraction (NER + Claim Extraction)

When a request arrives, two operations run **in parallel**:

#### 1A. NER Extraction
- Extract named entities and relationships from the full conversation (user messages + AI responses)
- **Incremental processing**: If NER results already cached in Redis for this conversation, only process new messages
- Store extracted entity graph in Apache AGE (PostgreSQL)
- Cache latest NER state in Redis with conversation-scoped key
- **Invalidation**: Cache is invalidated when new messages are added to the conversation

#### 1B. Claim Extraction (LLM-Powered)
Send the AI response + conversation context to **Gemini 2.0 Flash** with a structured prompt:

```json
{
  "claims": [
    {
      "id": "c1",
      "text": "The Eiffel Tower was built in 1889",
      "type": "factual",           // factual | statistical | temporal | causal | definition
      "importance": 0.8,           // 0-1, how critical this claim is to the response
      "suggested_sources": ["web_search", "conversation_history"],
      "search_queries": ["Eiffel Tower construction year"],
      "confidence_needs_checking": 0.7   // 0-1, likelihood this needs verification
    }
  ]
}
```

Claims with `confidence_needs_checking` below a configurable threshold (default: 0.3) are skipped to reduce latency.

**Why Gemini 2.0 Flash?** It's the best balance of intelligence + speed + structured output for claim extraction. Smart enough to properly decompose complex responses into atomic claims, fast enough for real-time use (~200-500ms), and supports native JSON output.

### Step 2: Multi-Source Verification

Each claim is verified against applicable sources **in parallel**. All sources return evidence snippets **with attribution**:

| Source | When Used | What It Returns |
|---|---|---|
| **Conversation History** | Always | Relevant entity/relationship from the graph + the original message turn reference |
| **Vector DB (User Docs)** | If `document_ids` provided in request | Matching document chunks + document name + chunk location |
| **Web Search (Tavily)** | If claim extractor suggests it + confidence > threshold | Search snippets + **source URLs** + page titles |

#### Source Attribution Rules
Every piece of evidence includes a traceable source reference:
- **Web Search**: Full URL (e.g., `https://en.wikipedia.org/wiki/Eiffel_Tower`), page title, relevant snippet
- **User Documents**: Document name, chunk text, chunk position within document
- **Conversation History**: Message index, speaker (user/AI), relevant excerpted text

### Step 3: NLI-Based Claim Verification

For each `(claim, evidence)` pair retrieved from the sources, run through the **NLI cross-encoder model**:

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
| Inference Speed | ~0.032s per (claim, evidence) pair |
| VRAM Usage | ~1.5–2 GB |
| Fact-checking | MiniCheck-DeBERTa outperforms all same-sized fact-checkers |

**Why DeBERTa-v3 over RoBERTa?**

| Metric | DeBERTa-v3-base | RoBERTa-large |
|---|---|---|
| SNLI Accuracy | **92.38%** | 92.0% |
| MNLI Accuracy | **90.04%** | 89.4% |
| Fact-checking (MiniCheck) | **Best in class** at this scale | Lower performance |
| Architecture | Disentangled attention + enhanced mask decoder | Optimized BERT |
| Parameters (base) | 86M | 125M (base), 355M (large) |
| Speed | Faster (fewer params at base size) | Comparable |

DeBERTa-v3 wins on accuracy, fact-checking performance, AND efficiency at the base size.

**Non-Blocking GPU Inference in FastAPI:**

The NLI model runs on GPU (RTX 4050, 6GB VRAM). To prevent blocking other FastAPI requests:
- Model inference runs via `asyncio.run_in_executor()` which offloads to a thread pool
- Alternatively, define inference routes as sync `def` (not `async def`) — FastAPI auto-runs these in a thread pool
- The GPU operation releases the Python GIL during CUDA compute, allowing other threads to proceed
- For maximum throughput: batch all (claim, evidence) pairs per request into a single forward pass

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

Where:
- `max_entailment_score`: Highest entailment score across all evidence for this claim
- `max_contradiction_score`: Highest contradiction score across all evidence
- `source_coverage_ratio`: Fraction of queried sources that returned any evidence
- `claim_importance`: From the claim extractor (how critical this claim is)
- `source_agreement_variance`: How much sources disagree with each other
- `evidence_count_norm`: Normalized count of evidence pieces found

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

| Score | Level | Color | Icon | Default Warning Message |
|---|---|---|---|---|
| 0–25 | LOW | 🟢 Green | ✓ | "Response appears well-grounded" |
| 26–50 | MODERATE | 🟡 Amber | ⚠ | "Some claims could not be fully verified" |
| 51–75 | HIGH | 🟠 Orange | ⚠ | "Multiple unverified or questionable claims detected" |
| 76–100 | CRITICAL | 🔴 Red | ✕ | "Response contains likely hallucinated content" |

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
| Temporal claim outdated | "This information may be outdated — latest source is from `{date}`" |

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
            "nli_score": 0.96
          }
        ]
      }
    },
    {
      "id": "c3",
      "text": "The mortality rate decreased by 47% after the intervention",
      "type": "statistical",
      "risk_score": 85,
      "status": "UNVERIFIED",
      "verification_details": {
        "entailment_score": 0.0,
        "contradiction_score": 0.0,
        "sources_checked": ["web_search", "vector_db"],
        "evidence": []
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
| `POST` | `/api/v1/detect` | Main hallucination detection — accepts AI response + context, returns full analysis |
| `POST` | `/api/v1/chat` | Proxy to LLM APIs — forwards user message to selected model, returns streamed response |
| `POST` | `/api/v1/documents/upload` | Upload document → chunk → embed → store in pgvector. Returns `document_id` |
| `GET` | `/api/v1/documents/{id}` | Get document metadata and chunk count |
| `DELETE` | `/api/v1/documents/{id}` | Delete document and its embeddings |
| `POST` | `/api/v1/conversations` | Create a new conversation context |
| `GET` | `/api/v1/conversations/{id}` | Get conversation history and NER state |
| `POST` | `/api/v1/conversations/{id}/messages` | Add messages to a conversation |

#### `POST /api/v1/detect` — Request

```json
{
  "conversation_id": "uuid",
  "model_id": "gpt-4o",
  "model_response": "The Eiffel Tower was built in 1889 by Gustave Eiffel...",
  "conversation_history": [
    { "role": "user", "content": "Tell me about the Eiffel Tower" },
    { "role": "assistant", "content": "The Eiffel Tower was built in 1889..." }
  ],
  "document_ids": ["doc-uuid-1", "doc-uuid-2"],
  "config": {
    "check_web": true,
    "check_documents": true,
    "check_conversation": true,
    "claim_threshold": 0.3
  }
}
```

#### `POST /api/v1/chat` — Request

```json
{
  "conversation_id": "uuid",
  "model_id": "gpt-4o",
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
│ ▼ GPT-4o          │ ▼ Claude 3.5 Son. │ ▼ Gemini 2.0    │
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
| **Model selector** | Dropdown in each column header. Can be changed at any point mid-conversation |
| **Unified input** | Single message input at the bottom. Message + conversation history sent to all selected models in parallel |
| **Parallel detection** | After each model responds, frontend calls `POST /detect` for each response independently and in parallel |
| **Hallucination overlay** | Expandable panel below each AI response showing: risk gauge, claim cards, source links, warnings |
| **Inline highlighting** | Risky claims highlighted directly in the response text (red/amber/green underlines) |
| **Document upload** | Upload PDFs/docs via header button → backend chunks + embeds → `document_ids` included in all future `/detect` calls |
| **Streaming** | Model responses stream in real-time; detection runs after stream completes |
| **Add/remove models** | "+ Add Model" button (max 3). Each column has an "×" to remove. Minimum 1 model required |

### Key Components

| Component | Purpose |
|---|---|
| `ChatWindow` | Individual model conversation column with messages + analysis overlay |
| `ModelSelector` | Dropdown with all supported models + model metadata (provider icon, name) |
| `MessageInput` | Unified input bar with file upload, send button |
| `RiskGauge` | Animated circular gauge (0–100) with color transitions |
| `ClaimBreakdown` | Expandable claim cards with status icons, evidence, source links |
| `WarningBanner` | Contextual alert bar with severity icon and message |
| `SourcePanel` | Clickable source references (URLs, document chunks, conversation turns) |
| `ComparisonView` | Grid layout manager that adjusts columns dynamically |

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

1. **Content script** detects AI response elements on supported LLM websites (ChatGPT, Claude, Gemini) using DOM observers
2. When a new AI response appears, content script extracts the response text + conversation history
3. If user has uploaded documents in the chat → extension captures them → sends to backend `/documents/upload` → receives `document_ids`
4. Content script sends detection request to **background service worker** (to avoid CORS)
5. Background worker calls `POST /api/v1/detect` with the response, conversation history, and document IDs
6. On response, content script renders:
   - **Risk badge**: Small colored circle (🟢🟡🟠🔴) with score number overlaid on the AI response
   - **Click to expand**: Floating panel with full claim breakdown, warnings, source links
7. Extension popup allows configuring: backend URL, toggle auto-detection, view detection history

### Supported Sites (Initial)

| Site | Detection Method |
|---|---|
| ChatGPT (chat.openai.com) | Monitor `div[data-message-author-role="assistant"]` elements |
| Claude (claude.ai) | Monitor assistant message containers |
| Gemini (gemini.google.com) | Monitor model response containers |

---

## Storage Architecture

### Single PostgreSQL Instance with Extensions

We use **one PostgreSQL database** with two extensions, avoiding the complexity of managing separate database systems:

#### Core Tables (PostgreSQL)

```sql
-- Conversations & Messages
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    metadata JSONB
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id),
    role VARCHAR(20) NOT NULL,  -- 'user' or 'assistant'
    content TEXT NOT NULL,
    model_id VARCHAR(50),       -- which LLM generated this (null for user)
    created_at TIMESTAMP DEFAULT NOW()
);

-- Documents (user uploads)
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id),
    filename VARCHAR(255),
    file_type VARCHAR(50),
    file_size_bytes INTEGER,
    chunk_count INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id),
    chunk_index INTEGER,
    content TEXT NOT NULL,
    embedding vector(768),      -- pgvector: nomic-embed-text produces 768d
    created_at TIMESTAMP DEFAULT NOW()
);

-- Analysis Results
CREATE TABLE analysis_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id),
    message_id UUID REFERENCES messages(id),
    model_id VARCHAR(50),
    overall_risk_score FLOAT,
    risk_level VARCHAR(20),
    warnings JSONB,
    processing_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE claim_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id UUID REFERENCES analysis_results(id),
    claim_text TEXT,
    claim_type VARCHAR(30),
    risk_score FLOAT,
    status VARCHAR(20),         -- VERIFIED | UNVERIFIED | CONTRADICTED | SKIPPED
    entailment_score FLOAT,
    contradiction_score FLOAT,
    evidence JSONB,             -- Array of evidence objects with source attribution
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### Vector Storage (pgvector)

```sql
-- Enable extension
CREATE EXTENSION IF NOT EXISTS vector;

-- HNSW index for fast similarity search
CREATE INDEX ON document_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Hybrid query example: vector search filtered by conversation
SELECT id, content, 1 - (embedding <=> $1) AS similarity
FROM document_chunks
WHERE document_id IN (
    SELECT id FROM documents WHERE conversation_id = $2
)
ORDER BY embedding <=> $1
LIMIT 5;
```

**Why pgvector over FAISS/ChromaDB?**
- **Same database** — no additional infrastructure to deploy/manage
- **Hybrid queries** — combine vector similarity with relational filters (filter by user, conversation, document) in a single SQL query
- **Concurrent performance** — outperforms ChromaDB under concurrent load (9s vs 23s avg in benchmarks)
- **HNSW indexing** — millisecond-level approximate nearest neighbor search
- **Scales** — handles 10–100M vectors before needing specialized solutions
- **FAISS drawback** — Raw speed king, but it's a library, not a database. Requires significant engineering for metadata filtering, persistence, and serving
- **ChromaDB drawback** — Great for prototyping, degrades under concurrency, limited to ~500K vectors practically

#### Graph Storage (Apache AGE)

```sql
-- Enable extension
CREATE EXTENSION IF NOT EXISTS age;

-- Load graph module
LOAD 'age';
SET search_path = ag_catalog, "$user", public;

-- Create per-conversation graph
SELECT create_graph('conversation_{uuid}');

-- Store entities and relationships
SELECT * FROM cypher('conversation_{uuid}', $$
    CREATE (e:Entity {name: 'Eiffel Tower', type: 'STRUCTURE', message_idx: 0})
    RETURN e
$$) AS (e agtype);

SELECT * FROM cypher('conversation_{uuid}', $$
    MATCH (a:Entity {name: 'Eiffel Tower'})
    CREATE (a)-[:BUILT_BY {message_idx: 0}]->(b:Entity {name: 'Gustave Eiffel', type: 'PERSON'})
    RETURN a, b
$$) AS (a agtype, b agtype);

-- Query for contradiction checking
SELECT * FROM cypher('conversation_{uuid}', $$
    MATCH (e:Entity)-[r]->(related)
    WHERE e.name = 'Eiffel Tower'
    RETURN e.name, type(r), related.name, r.message_idx
$$) AS (entity agtype, rel_type agtype, related agtype, msg_idx agtype);
```

#### Redis Cache Strategy

| Key Pattern | Value | TTL | Invalidation |
|---|---|---|---|
| `ner:{conversation_id}` | Serialized NER results (entities + relationships) | 1 hour | On new message added to conversation |
| `ner:{conversation_id}:last_msg_idx` | Index of last processed message | 1 hour | On new message |
| `session:{session_id}` | Session state | 24 hours | On session end |
| `ratelimit:{ip}:{endpoint}` | Request count | 1 minute | Auto-expire |

---

## Supported LLM Models

The system supports **5-7+ models** ranging from state-of-the-art to budget options, enabling meaningful hallucination comparison:

| Tier | Model | Provider | Strengths |
|---|---|---|---|
| 🥇 **Tier 1** | GPT-4o | OpenAI | Best overall reasoning and accuracy |
| 🥇 **Tier 1** | Claude 3.5 Sonnet | Anthropic | Excellent at nuanced, factual responses |
| 🥇 **Tier 1** | Gemini 2.0 Pro | Google | Strong factual grounding, multimodal |
| 🥈 **Tier 2** | GPT-4o-mini | OpenAI | Good accuracy, faster and cheaper |
| 🥈 **Tier 2** | Claude 3.5 Haiku | Anthropic | Fast, decent accuracy |
| 🥈 **Tier 2** | Gemini 2.0 Flash | Google | Very fast, good for straightforward queries |
| 🥉 **Tier 3** | Llama 3.1 70B (via Ollama) | Meta | Open-source, local option |

Users can select up to 3 models in the comparison view. The system sends the same message to all selected models, gets their responses, and runs independent hallucination detection on each — revealing which models hallucinate more on the same query.

---

## Technical Decisions & Rationale

### Why DeBERTa-v3-base for NLI (Not RoBERTa)?
- **Higher accuracy**: 92.38% SNLI vs RoBERTa's 92.0% (at base size, DeBERTa-v3 uses fewer params)
- **Better fact-checking**: MiniCheck-DeBERTa outperforms all same-scale fact-checkers on LLM-AggreFact benchmark
- **Efficient architecture**: Disentangled attention + enhanced mask decoder = better results with fewer parameters
- **VRAM friendly**: Base model fits comfortably in ~1.5–2 GB, leaving room for batching on 6GB RTX 4050

### Why Gemini 2.0 Flash for Claim Extraction?
- **Smart enough**: Properly decomposes complex responses into atomic verifiable claims
- **Structured output**: Native JSON mode ensures reliable parsing
- **Fast**: ~200–500ms per extraction call
- **Cost-effective**: Significantly cheaper than GPT-4o or Claude for this high-frequency operation

### Why Tavily for Web Search (Not Serper)?
- **AI-native**: Built specifically for LLM/RAG workflows, returns structured content optimized for AI consumption
- **Source URLs included**: Every result includes the source URL, page title, and relevant snippet — critical for our source attribution requirement
- **Content extraction**: Can return full page content, not just SERP snippets
- **Hallucination reduction**: Built-in content validation and source quality filtering
- **Serper alternative**: Cheaper ($0.001/query) but returns raw SERP data — we'd need to build our own content extraction and quality filtering on top

### Why nomic-embed-text for Embeddings (via Ollama)?
- **Fully local**: Runs via Ollama, no API costs, no data leaving the machine
- **Accurate**: Outperforms OpenAI text-embedding-ada-002 and text-embedding-3-small on both short and long-context tasks
- **Fast**: ~257ms per document on CPU, faster on GPU
- **768 dimensions**: Good balance of quality and storage efficiency for pgvector
- **Large context window**: Handles long document chunks without truncation issues

### Why pgvector over FAISS/ChromaDB?
See [Storage Architecture](#storage-architecture) section for detailed comparison.

### Non-Blocking NLI Inference in FastAPI
The DeBERTa model runs on GPU. Since GPU operations release the Python GIL during CUDA compute:
- Wrap inference in `asyncio.run_in_executor()` → offloads to thread pool → event loop stays free
- Batch all (claim, evidence) pairs per request into a single forward pass for efficiency
- Other FastAPI requests are NOT blocked while inference runs

---

## Project Structure

```
AI_HallicunationDetectionSystem/
│
├── README.md                        # This file
│
├── backend/                         # FastAPI backend
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                  # FastAPI app, startup events, middleware
│   │   ├── config.py                # Environment config, API keys, model paths
│   │   │
│   │   ├── api/                     # Route handlers
│   │   │   ├── __init__.py
│   │   │   ├── detect.py            # POST /detect — main hallucination detection
│   │   │   ├── chat.py              # POST /chat — LLM proxy with streaming
│   │   │   ├── documents.py         # Document upload, retrieval, deletion
│   │   │   └── conversations.py     # Conversation CRUD
│   │   │
│   │   ├── core/                    # Core detection pipeline
│   │   │   ├── __init__.py
│   │   │   ├── claim_extractor.py   # LLM-powered claim extraction (Gemini 2.0 Flash)
│   │   │   ├── ner_extractor.py     # Named entity recognition (spaCy)
│   │   │   ├── verifier.py          # Multi-source verification orchestrator
│   │   │   ├── nli_model.py         # DeBERTa NLI model wrapper + GPU inference
│   │   │   ├── risk_scorer.py       # Per-claim + overall risk score calculation
│   │   │   ├── web_search.py        # Tavily API integration
│   │   │   └── document_processor.py # Document chunking + embedding pipeline
│   │   │
│   │   ├── models/                  # Pydantic schemas
│   │   │   ├── __init__.py
│   │   │   ├── detect.py            # DetectionRequest, DetectionResponse, ClaimResult
│   │   │   ├── chat.py              # ChatRequest, ChatResponse
│   │   │   ├── documents.py         # DocumentUpload, DocumentResponse
│   │   │   └── conversations.py     # ConversationCreate, MessageAdd
│   │   │
│   │   ├── db/                      # Database layer
│   │   │   ├── __init__.py
│   │   │   ├── postgres.py          # SQLAlchemy + asyncpg connection
│   │   │   ├── vector.py            # pgvector operations (embed, search)
│   │   │   ├── graph.py             # Apache AGE operations (entity CRUD, query)
│   │   │   ├── redis.py             # Redis cache operations
│   │   │   └── models.py            # SQLAlchemy ORM models
│   │   │
│   │   └── utils/                   # Helpers
│   │       ├── __init__.py
│   │       ├── llm_clients.py       # OpenAI, Anthropic, Google API clients
│   │       └── text_processing.py   # Chunking, tokenization helpers
│   │
│   ├── alembic/                     # Database migrations
│   │   ├── alembic.ini
│   │   └── versions/
│   │
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
│
├── frontend/                        # Next.js chat frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx             # Main chat page
│   │   │   └── globals.css
│   │   │
│   │   ├── components/
│   │   │   ├── chat/
│   │   │   │   ├── ChatWindow.tsx       # Individual model conversation column
│   │   │   │   ├── MessageBubble.tsx    # Single message with inline highlights
│   │   │   │   ├── MessageInput.tsx     # Unified input bar
│   │   │   │   └── ComparisonView.tsx   # Dynamic grid layout manager
│   │   │   │
│   │   │   ├── analysis/
│   │   │   │   ├── RiskGauge.tsx        # Animated circular gauge (0-100)
│   │   │   │   ├── ClaimBreakdown.tsx   # Expandable claim cards
│   │   │   │   ├── WarningBanner.tsx    # Contextual alert bar
│   │   │   │   ├── SourcePanel.tsx      # Source references with links
│   │   │   │   └── AnalysisOverlay.tsx  # Container for all analysis components
│   │   │   │
│   │   │   └── common/
│   │   │       ├── ModelSelector.tsx     # Model dropdown
│   │   │       ├── DocumentUpload.tsx    # File upload component
│   │   │       └── Header.tsx           # App header
│   │   │
│   │   ├── lib/
│   │   │   ├── api.ts               # Backend API client
│   │   │   ├── types.ts             # TypeScript interfaces
│   │   │   └── constants.ts         # Model list, colors, thresholds
│   │   │
│   │   └── hooks/
│   │       ├── useChat.ts           # Chat state management
│   │       ├── useDetection.ts      # Hallucination detection hook
│   │       └── useDocuments.ts      # Document upload hook
│   │
│   ├── public/
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.js
│   └── Dockerfile
│
├── extension/                       # Chrome browser extension
│   ├── manifest.json                # MV3 manifest
│   ├── content.js                   # Page injection, DOM observers
│   ├── background.js                # Service worker, API communication
│   ├── popup.html                   # Extension popup settings
│   ├── popup.js                     # Popup logic
│   ├── overlay.js                   # Risk badge + analysis panel rendering
│   ├── styles.css                   # Overlay styling
│   └── icons/                       # Extension icons
│
├── docker-compose.yml               # PostgreSQL + Redis + Backend + Frontend
├── .env.example                     # Required environment variables
└── .gitignore
```

---

## Getting Started

### Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- **Docker & Docker Compose** (for PostgreSQL + Redis)
- **Ollama** (for local embedding model)
- **GPU**: NVIDIA RTX 4050 6GB or equivalent (for DeBERTa NLI inference)
- **API Keys**: Gemini (claim extraction), Tavily (web search), + keys for chat LLMs (OpenAI, Anthropic, Google)

### Quick Start

```bash
# 1. Clone the repository
git clone <repo-url>
cd AI_HallicunationDetectionSystem

# 2. Start infrastructure (PostgreSQL + Redis)
docker-compose up -d postgres redis

# 3. Pull the embedding model via Ollama
ollama pull nomic-embed-text

# 4. Backend setup
cd backend
python -m venv venv
venv\Scripts\activate            # Windows
pip install -r requirements.txt
python -m spacy download en_core_web_trf

# Download DeBERTa NLI model (first run auto-downloads from HuggingFace)
# Or pre-download: python -c "from transformers import AutoModel; AutoModel.from_pretrained('cross-encoder/nli-deberta-v3-base')"

# 5. Configure environment
cp .env.example .env
# Edit .env with your API keys

# 6. Run database migrations
alembic upgrade head

# 7. Start backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 8. Frontend setup (new terminal)
cd frontend
npm install
npm run dev

# 9. Extension (load unpacked in Chrome)
# Go to chrome://extensions → Developer mode → Load unpacked → select extension/
```

### Environment Variables

```env
# Database
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/hallucination_db

# Redis
REDIS_URL=redis://localhost:6379/0

# Ollama (local embeddings)
OLLAMA_BASE_URL=http://localhost:11434

# LLM API Keys (for chat + claim extraction)
GOOGLE_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key

# Web Search
TAVILY_API_KEY=your_tavily_api_key

# NLI Model
NLI_MODEL_NAME=cross-encoder/nli-deberta-v3-base
NLI_DEVICE=cuda    # or "cpu" if no GPU

# Pipeline Config
CLAIM_CONFIDENCE_THRESHOLD=0.3
WEB_SEARCH_ENABLED=true
MAX_CLAIMS_PER_RESPONSE=20
```

---