"""
Comprehensive Document KB + Hallucination Detection Accuracy Test (v2).

Tests 15 document chunks across 5 domains + 8 diverse claims.
Each test case sends ONE atomic claim to avoid LLM claim-splitting issues.
"""

import asyncio
import logging
import uuid
from sqlalchemy import text
from app.db.engine import async_session_maker
from app.db.models import Conversation, Document, DocumentChunk
from app.api.detect import _run_detection_pipeline
from app.core.nli_model import get_nli_model
from app.core.embeddings import get_embedding_pipeline

logging.basicConfig(level=logging.WARNING)
# Suppress noisy loggers
for noisy in ["sqlalchemy", "httpx", "arxiv", "google_genai", "sentence_transformers", "app.core.domain_source_router", "app.core.evidence_ranker"]:
    logging.getLogger(noisy).setLevel(logging.ERROR)

# ── 15 diverse document chunks ──────────────────────────────────────────

MOCK_DOCUMENTS = {
    "quantum_computing_whitepaper.pdf": [
        "Quantum computing leverages quantum mechanical phenomena such as superposition and entanglement to process information. Unlike classical bits which exist as 0 or 1, quantum bits (qubits) can exist in a superposition of both states simultaneously, enabling massive parallelism in computation.",
        "Quantum error correction remains one of the biggest challenges in building practical quantum computers. Current systems require approximately 1000 physical qubits to create a single logical qubit. Google's Willow chip demonstrated a breakthrough in 2024 by achieving below-threshold error correction with 105 qubits.",
        "IBM's Condor processor, released in 2023, contains 1,121 superconducting qubits. However, qubit count alone does not determine computational advantage. Google demonstrated quantum supremacy in 2019 with its 53-qubit Sycamore processor by completing a calculation in 200 seconds that would take a classical supercomputer 10,000 years.",
    ],
    "climate_science_report.pdf": [
        "Global atmospheric CO2 concentrations reached 421 parts per million (ppm) in 2023, the highest level in at least 800,000 years. Pre-industrial CO2 levels were approximately 280 ppm. The Keeling Curve, maintained at Mauna Loa Observatory since 1958, shows an unbroken upward trend.",
        "According to NASA and NOAA data, the global average surface temperature has increased by approximately 1.1 degrees Celsius since the pre-industrial era (1850-1900). The year 2023 was confirmed as the warmest year on record, surpassing 2016. The Paris Agreement aims to limit warming to 1.5 degrees Celsius.",
        "Global mean sea level has risen approximately 21-24 centimeters since 1880. The rate of rise has accelerated from 1.4 mm/year throughout most of the 20th century to 3.6 mm/year from 2006-2015. Major contributors include thermal expansion of ocean water and melting of glaciers and ice sheets.",
    ],
    "pharma_drug_trials.pdf": [
        "Clinical drug trials follow four phases. Phase I tests safety in 20-100 healthy volunteers. Phase II evaluates efficacy and side effects in 100-300 patients. Phase III confirms effectiveness in 1,000-3,000 patients compared to existing treatments. Phase IV involves post-market surveillance after FDA approval.",
        "In the Phase III trial of Zepharion (XR-7742), conducted across 47 clinical sites worldwide, the drug demonstrated a 34% reduction in tumor progression compared to the standard of care. However, 12% of patients experienced Grade 3 adverse events including neutropenia and hepatotoxicity. The trial enrolled 2,847 patients with advanced non-small cell lung cancer.",
        "The FDA approval process typically takes 10-15 years from initial drug discovery to market. The average cost of developing a new drug is estimated at $2.6 billion. Only about 12% of drugs that enter clinical trials eventually receive FDA approval.",
    ],
    "financial_markets_analysis.pdf": [
        "The S&P 500 index, created in 1957, has delivered an average annual return of approximately 10.7% including dividends over its history. The index experienced its worst single-day decline of 20.47% on Black Monday, October 19, 1987. It reached an all-time closing high of 6,144.15 on February 19, 2025.",
        "Bitcoin, created by the pseudonymous Satoshi Nakamoto, launched in 2009 with a genesis block mined on January 3rd. The maximum supply is capped at 21 million coins. As of early 2025, approximately 19.6 million bitcoins have been mined. The Bitcoin halving event occurs approximately every 4 years, most recently in April 2024.",
        "The Federal Reserve raised the federal funds rate from near-zero to a range of 5.25-5.50% between March 2022 and July 2023, the fastest tightening cycle in 40 years. This was in response to inflation reaching 9.1% in June 2022, the highest since November 1981.",
    ],
    "space_exploration_docs.pdf": [
        "NASA's Perseverance rover landed on Mars on February 18, 2021, in Jezero Crater. It carries the Ingenuity helicopter, which completed the first powered flight on another planet on April 19, 2021. Perseverance has collected multiple rock samples intended for return to Earth by a future Mars Sample Return mission.",
        "The James Webb Space Telescope (JWST), launched on December 25, 2021, orbits the Sun at the second Lagrange point (L2), approximately 1.5 million kilometers from Earth. Its 6.5-meter primary mirror, composed of 18 gold-plated beryllium segments, can observe in infrared wavelengths from 0.6 to 28 micrometers.",
        "SpaceX's Starship is a fully reusable super heavy-lift launch vehicle. Standing 121 meters tall, it is the tallest and most powerful rocket ever built. The Super Heavy booster uses 33 Raptor engines generating approximately 7,590 tonnes of thrust at liftoff. Starship is designed to carry up to 150 tonnes to low Earth orbit.",
    ],
}


# Each test sends a SINGLE atomic claim to prevent LLM claim-splitting
TEST_CASES = [
    {
        "text": "Google demonstrated quantum supremacy in 2019 using a 53-qubit Sycamore processor.",
        "expected": "VERIFIED",
        "reason": "Directly supported by quantum_computing chunk 2",
    },
    {
        "text": "IBM's Condor processor contains 2,000 superconducting qubits.",
        "expected": "CONTRADICTED",
        "reason": "Chunk says 1,121 qubits, not 2,000",
    },
    {
        "text": "Global atmospheric CO2 concentrations reached 421 ppm in 2023.",
        "expected": "VERIFIED",
        "reason": "Directly matches climate_science chunk 0",
    },
    {
        "text": "The James Webb Space Telescope orbits Earth at an altitude of 550 kilometers.",
        "expected": "CONTRADICTED",
        "reason": "JWST orbits Sun at L2 (1.5M km), NOT Earth LEO",
    },
    {
        "text": "Bitcoin has a maximum supply cap of 21 million coins.",
        "expected": "VERIFIED",
        "reason": "Directly supported by financial_markets chunk 1",
    },
    {
        "text": "The drug Zepharion demonstrated a 34% reduction in tumor progression in Phase III trials.",
        "expected": "VERIFIED",
        "reason": "Fictional drug only in KB - directly matches pharma chunk 1",
    },
    {
        "text": "SpaceX Starship can carry up to 500 tonnes to low Earth orbit.",
        "expected": "CONTRADICTED",
        "reason": "KB says 150 tonnes, not 500",
    },
    {
        "text": "The global average surface temperature has increased by approximately 1.1 degrees Celsius since the pre-industrial era.",
        "expected": "VERIFIED",
        "reason": "Directly matches climate_science chunk 1",
    },
]


async def run_test():
    print("\n" + "=" * 80)
    print("  HALLUCINATION DETECTION ACCURACY TEST (v2)")
    print("  15 KB Chunks | 8 Atomic Claims | KB + Web Hybrid")
    print("=" * 80)

    # Load models
    print("\n[1/4] Loading NLI Model...")
    get_nli_model().load()
    print("      Done.\n")

    print("[2/4] Loading Embedding Model...")
    embedder = get_embedding_pipeline()
    await embedder.embed_texts(["warmup"])
    print("      Done.\n")

    # Build KB
    print("[3/4] Building Knowledge Base...")
    conv_id = str(uuid.uuid4())
    doc_ids = {}
    all_chunks_text = []
    chunk_metadata = []

    for filename, chunks in MOCK_DOCUMENTS.items():
        doc_id = str(uuid.uuid4())
        doc_ids[filename] = doc_id
        for idx, chunk_text in enumerate(chunks):
            all_chunks_text.append(chunk_text)
            chunk_metadata.append({"doc_id": doc_id, "filename": filename, "chunk_index": idx, "text": chunk_text})

    all_embeddings = await embedder.embed_texts(all_chunks_text)

    async with async_session_maker() as session:
        session.add(Conversation(id=conv_id))
        for filename, doc_id in doc_ids.items():
            session.add(Document(id=doc_id, conversation_id=conv_id, filename=filename, content_type="pdf"))
        for i, meta in enumerate(chunk_metadata):
            session.add(DocumentChunk(document_id=meta["doc_id"], chunk_index=meta["chunk_index"], text_content=meta["text"], embedding=all_embeddings[i]))
        await session.commit()

    all_doc_id_list = list(doc_ids.values())
    print(f"      {len(chunk_metadata)} chunks across {len(doc_ids)} docs inserted.\n")

    # Run tests
    print("[4/4] Running 8 Test Claims...\n")
    print("-" * 80)

    summary = []

    for case_idx, case in enumerate(TEST_CASES):
        claim_text = case["text"]
        expected = case["expected"]
        reason = case["reason"]

        print(f"\n  Test {case_idx + 1}/8: \"{claim_text[:70]}{'...' if len(claim_text)>70 else ''}\"")
        print(f"  Expected: {expected} | Reason: {reason}")

        try:
            result = await _run_detection_pipeline(
                model_response=claim_text,
                conversation_history=[],
                conversation_id=conv_id,
                document_ids=all_doc_id_list,
                config={"check_web": True, "check_documents": True, "check_conversation": False},
            )

            vr_list = result["verification_results"]
            # Use the first non-SKIPPED result (since we send atomic claims)
            res = None
            for vr in vr_list:
                if vr.status.value != "SKIPPED":
                    res = vr
                    break
            if res is None and vr_list:
                res = vr_list[0]

            if res is None:
                print(f"  >> No claims extracted!")
                summary.append({"claim": claim_text[:55], "expected": expected, "got": "NO_CLAIMS", "passed": False})
                continue

            status = res.status.value
            ent = con = neu = 0.0
            kb_chunks = []

            if res.evidence:
                ent = max([(ev.nli_scores or {}).get("entailment", 0) for ev in res.evidence] + [0])
                con = max([(ev.nli_scores or {}).get("contradiction", 0) for ev in res.evidence] + [0])
                neu = max([(ev.nli_scores or {}).get("neutral", 0) for ev in res.evidence] + [0])
                for ev in res.evidence:
                    if ev.source_tier and ev.source_tier.value == "vector_db":
                        kb_chunks.append(ev.snippet[:80])

            sources = [s.value for s in res.sources_checked]
            reasoning = (res.reasoning or "N/A")[:200]

            passed = (
                (expected == "VERIFIED" and status in ("VERIFIED", "SUPPORTED")) or
                (expected == "CONTRADICTED" and status == "CONTRADICTED")
            )

            mark = "PASS" if passed else "FAIL"
            print(f"  >> Status: {status} [{mark}]")
            print(f"     NLI: Ent={ent:.3f} | Con={con:.3f} | Neu={neu:.3f}")
            print(f"     Sources: {sources}")
            if kb_chunks:
                print(f"     KB Chunks Retrieved: {len(kb_chunks)}")
                for kc in kb_chunks[:2]:
                    print(f"       - \"{kc}...\"")
            print(f"     Reasoning: {reasoning}")

            summary.append({"claim": claim_text[:55], "expected": expected, "got": status, "passed": passed})

        except Exception as e:
            print(f"  >> ERROR: {e}")
            import traceback
            traceback.print_exc()
            summary.append({"claim": claim_text[:55], "expected": expected, "got": "ERROR", "passed": False})

        print(f"  {'~' * 76}")

    # Summary
    print("\n\n" + "=" * 80)
    print("  ACCURACY SUMMARY")
    print("=" * 80)
    print(f"\n  {'#':<4} {'Claim':<57} {'Expected':<14} {'Got':<14} {'Pass':<5}")
    print(f"  {'─'*4} {'─'*57} {'─'*14} {'─'*14} {'─'*5}")

    passed_count = 0
    for i, r in enumerate(summary):
        p = "YES" if r["passed"] else "NO"
        if r["passed"]:
            passed_count += 1
        print(f"  {i+1:<4} {r['claim']:<57} {r['expected']:<14} {r['got']:<14} {p:<5}")

    pct = (passed_count / len(summary)) * 100 if summary else 0
    print(f"\n  Overall Accuracy: {passed_count}/{len(summary)} ({pct:.0f}%)")
    print("=" * 80)

    # Cleanup
    print("\nCleaning up...")
    async with async_session_maker() as session:
        await session.execute(text(f"DELETE FROM conversations WHERE id = '{conv_id}'"))
        await session.commit()
    print("Done.\n")


if __name__ == "__main__":
    asyncio.run(run_test())
