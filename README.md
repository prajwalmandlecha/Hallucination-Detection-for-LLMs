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
  - [Step 4: LLM Adjudication](#step-4-llm-adjudication)
  - [API Endpoints](#api-endpoints)
- [Frontend — Multi-Model Chat Interface](#frontend--multi-model-chat-interface)
- [Browser Extension](#browser-extension)
- [Storage Architecture](#storage-architecture)
- [Supported LLM Models](#supported-llm-models)
- [Getting Started](#getting-started)

---

## Overview

Large Language Models (LLMs) frequently generate confident-sounding but factually incorrect responses — a phenomenon known as **hallucination**. This system acts as a **post-generation verification layer** that:

1. **Intercepts** any AI response (via our chat frontend or browser extension)
2. **Extracts** individual factual claims from the response
3. **Verifies** each claim against multiple sources (conversation history, user documents, web search, APIs)
4. **Scores** hallucination risk at both claim-level and response-level using NLI and LLM Adjudication
5. **Displays** results with detailed explanations, source links, and warnings

### What Makes This Different?

| Feature | Our System |
|---|---|
| **Multi-source verification** | Checks against conversation history, user documents, specific domains (Arxiv, CrossRef, PubMed, Semantic Scholar) AND web search simultaneously |
| **Claim-level granularity** | Every individual claim is scored, not just the entire response |
| **LLM-driven source selection** | The claim extractor intelligently suggests which sources to check per claim |
| **Source attribution** | Every verification result links back to the actual source (URL, document chunk, conversation turn) |
| **ZERO-dependency Vectorization** | Runs locally inside the Python process using SentenceTransformers (`all-MiniLM-L6-v2`) — NO Ollama needed |
| **Hybrid Analysis Pipeline** | Uses fast DeBERTa-v3 NLP for entailment/contradiction math, plus Gemini 3 Flash for intelligent final-adjudication |

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
│  │    POST /detect  │  POST /chat  │  POST /documents/upload        │   │
│  └──────────┬───────────────────────────────────────────────────────┘   │
│             │                                                           │
│             ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐        │
│  │              STEP 1: PARALLEL EXTRACTION                    │        │
│  │  ┌─────────────────────┐   ┌──────────────────────────────┐ │        │
│  │  │  NER Extractor      │   │  Claim Extractor (LLM)       │ │        │
│  │  │  (spaCy en_core_    │   │  (Groq Llama 3.3 70B)        │ │        │
│  │  │   web_sm)           │   │                              │ │        │
│  │  └────────┬────────────┘   └────────────┬─────────────────┘ │        │
│  └───────────┼─────────────────────────────┼───────────────────┘        │
│              ▼                             ▼                            │
│  ┌─────────────────────────────────────────────────────────────┐        │
│  │        STEP 2: MULTI-SOURCE VERIFICATION (Domain Router)    │        │
│  │                                                             │        │
│  │  ┌────────────────┐ ┌────────────────┐ ┌─────────────────┐  │        │
│  │  │ Memory (NER)   │ │ Vector DB      │ │ Web / Domain API│  │        │
│  │  │ Match prior    │ │ ST natively    │ │ Arxiv, PubMed,  │  │        │
│  │  │ chat history   │ │ pgvector 384d  │ │ Tavily, Serper  │  │        │
│  │  └──────┬─────────┘ └──────┬─────────┘ └──────┬──────────┘  │        │
│  └─────────┼──────────────────┼──────────────────┼─────────────┘        │
│            └─────────┬────────┘──────────────────┘                      │
│                      ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────┐        │
│  │        STEP 3: NLI VERIFICATION (DeBERTa-v3-base)           │        │
│  │        Scores Entailment, Contradiction, and Neutral        │        │
│  └───────────────────────────┬─────────────────────────────────┘        │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────┐        │
│  │        STEP 4: LLM ADJUDICATION (Gemini 3 Flash)            │        │
│  │        Generates natural language reasoning and risk levels │        │
│  └─────────────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Features

### 🔍 Core Detection Engine
- **LLM-powered claim extraction** — Uses Groq Llama 3.3 70B to decompose AI responses into individual verifiable claims
- **Domain-Specific Verification Router** — Routes claims automatically to highly specific academic endpoints (`Crossref`, `Semantic Scholar`, `Pubmed`, `arXiv`)
- **Native PGVector Hybrid Search** — Utilizes `all-MiniLM-L6-v2` locally inside Python for 384d chunk embedding, completely free from constraints.
- **NLI-based semantic verification** — DeBERTa-v3-base cross-encoder classifies each (claim, evidence) pair 
- **LLM Adjudication** — Resolves edge-cases using Gemini 3 Preview model reasoning capabilities to output an intuitive human-readable justification.
- **Source-attributed explanations** — Every flagged claim links back to the actual source URL, document chunk, or conversation turn

### 💬 Multi-Model Chat Interface
- **Compare up to 3 LLMs side-by-side** — Send one message, get responses from multiple models simultaneously
- **10+ free models** — Groq, NVIDIA NIM, OpenRouter — no paid API keys required
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
| **Embeddings** | all-MiniLM-L6-v2 (via SentenceTransformers) | Local, free, 384d vectors |
| **Web Search** | Tavily, Serper, Google Fact Check API, Wikipedia API,etc Domain Specific Search APIs | Domain Specific Knowledge |
| **Chat LLMs** | Groq / NVIDIA NIM / OpenRouter | All free-tier — no paid API keys needed |
| **Containerization** | Docker + Docker Compose + NVIDIA Container Toolkit | GPU passthrough, reproducible deployment |

---

## Backend — Detection Pipeline

### Step 1: Parallel Extraction (NER + Claim Extraction)

When a request arrives, two operations run **in parallel**:

#### 1A. NER Extraction (spaCy)
- Extract named entities from conversation messages using `en_core_web_sm`
- **Entity types**: PERSON, ORG, GPE, DATE, CARDINAL, EVENT, PRODUCT, etc.
- **Incremental processing**: Tracks `last_processed_index` — only runs spaCy on new messages, not the full conversation history
- **Storage**: Each entity stored as a flat row in PostgreSQL's `extracted_entities` table, linked to its source `conversation_id`
- **Duplicates**: If "Einstein" appears in messages #1, #3, and #5 → 3 separate rows, each linked to its source message. The verifier finds all matches and NLI picks the best evidence.

#### 1B. Claim Extraction (LLM-Powered)
Send the AI response to **Groq Llama 3.3 70B** to generate atomic claims categorized by domain.

### Step 2: Multi-Source Verification
The system utilizes a `DomainSourceRouter` to gather 10-20 pieces of evidence per claim from:
- Academic endpoints (PubMed, Arxiv, SemanticScholar)
- Web (Tavily/Serper)
- Vector DB (user document uploads)
- Semantic History matches


### Step 3: NLI-Based Claim Verification

For each `(claim, evidence)` pair retrieved from the sources, run through the **DeBERTa NLI cross-encoder**:
- **ENTAILMENT** (0–1) | Evidence supports the claim 
- **CONTRADICTION** (0–1) | Evidence contradicts the claim
- **NEUTRAL** (0–1) | Evidence is inconclusive


### Step 4: LLM Adjudication

Raw math is passed into **Gemini 3 Flash Preview** to output an easy-to-understand status:
`VERIFIED`, `PARTIALLY_VERIFIED`, `CONTRADICTED`, `SKIPPED`.

The adjudicator catches nuanced contradictions, understands temporal shifts, flags subjective hallucination statements masquerading as factual, and provides a conversational `reasoning` and `suggestion` for the frontend.

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/v1/models` | List all available LLM models |
| `POST` | `/api/v1/detect` | Main hallucination detection — accepts AI response + context, returns full analysis |
| `POST` | `/api/v1/chat` | Proxy to LLM APIs — forwards user message to selected model, supports SSE streaming |
| `POST` | `/api/v1/documents/upload` | Upload document → chunk → natively embed via SentenceTransformers → store in pgvector |
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

We use **one PostgreSQL 16 database** with the `pgvector` extension, configured identically for sync and async IO:

- `conversations` & `messages`
- `documents` & `document_chunks` (containing `embedding vector(384)`)
- `extracted_entities` (for memory search)

**Why pgvector over FAISS/ChromaDB?**
- **Same database** — no additional infrastructure to deploy/manage
- **Hybrid queries** — combine vector similarity with relational filters in a single SQL query
- **Concurrent performance** — outperforms ChromaDB under concurrent load
- **Scales** — handles 10–100M vectors before needing specialized solutions

---

## Supported LLM Models

All supported models utilize **free-tier APIs**:

| Tier | Model | Provider |
|---|---|---|
| 🥇 | Llama 3.3 70B | Groq |
| 🥇 | Gemini 3 Flash Preview | Google GenAI |
| 🥇 | Llama 3.1 70B | NVIDIA NIM |
| 🥇 | Nemotron 70B | OpenRouter |
| 🥈 | Llama 3.1 8B | Groq |
| 🥈 | Gemma 2 9B | Groq |

---

## Getting Started

### Prerequisites

- **Python 3.13+**
- **Docker & Docker Compose** (for PostgreSQL)
- **NVIDIA GPU** with driver ≥ 556.12 (for CUDA 12.4 NLI inference)
- **NVIDIA Container Toolkit** (for GPU passthrough in Docker)
- **API Keys** :
  - **Groq** — `console.groq.com` (Claim extraction + chat)
  - **Tavily / Serper** (Web Search)
  - **NVIDIA NIM** — `build.nvidia.com` (chat)
  - **OpenRouter** — `openrouter.ai` (chat)
  - **Gemini** — `aistudio.google.com` (Adjudication and Chat)

### Quick Start

```bash
# 1. Clone the repository
git clone <repo-url>
cd AI_HallicunationDetectionSystem

# 2. Start PostgreSQL with pgvector
docker compose up -d postgres

# 3. Backend setup
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1            # Windows

# Install Dependencies 
pip install -r requirements.txt
python -m spacy download en_core_web_sm

# 4. Configure environment
cp .env.example .env
# Edit .env with your API keys 

# 5. Run database migrations
alembic upgrade head

# 6. Start Backend
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