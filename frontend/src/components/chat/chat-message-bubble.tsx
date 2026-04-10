import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type RiskLevel = "none" | "green" | "amber" | "red";

export interface ClaimEvidenceItem {
  sourceType: string;
  sourceTier?: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  documentName?: string | null;
  chunkIndex?: number | null;
  messageIndex?: number | null;
  snippet?: string;
  nliLabel?: string;
  nliScores?: Record<string, number>;
}

export interface ClaimVerificationDetails {
  entailmentScore?: number;
  contradictionScore?: number;
  neutralScore?: number;
  sourceCoverage?: number;
  sourceAgreementVariance?: number;
  sourcesChecked?: string[];
  evidence?: ClaimEvidenceItem[];
}

export interface HallucinationSpan {
  claimId: string;
  text: string;
  exactQuote?: string;
  domain?: string;
  riskScore: number;
  risk: RiskLevel;
  status?:
    | "VERIFIED"
    | "PARTIALLY_VERIFIED"
    | "UNVERIFIED"
    | "CONTRADICTED"
    | "UNVERIFIABLE_SOURCE"
    | "OPINION"
    | "SKIPPED";
  confidence?: number;
  reasoning?: string;
  suggestion?: string;
  suggestedSources?: string[];
  note?: string;
  citations?: string[];
  verificationDetails?: ClaimVerificationDetails;
}

export interface DetectionWarningView {
  type: string;
  message: string;
  claimId: string;
  sourceUrl?: string | null;
}

export interface DetectionMetadataView {
  processingTimeMs: number;
  claimsExtracted: number;
  claimsVerified: number;
  claimsSkipped: number;
  sourcesQueried: string[];
  platform?: string | null;
  conversationId?: string | null;
}

export interface DetectionSummaryView {
  responseId: string;
  overallRiskScore: number;
  riskLevel: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  riskColor: string;
  warningMessage: string;
  warnings: DetectionWarningView[];
  metadata?: DetectionMetadataView;
  resultsPresent?: boolean;
}

export interface MessageProps {
  id: string;
  role: "user" | "assistant";
  content: string;
  spans?: HallucinationSpan[];
  detectionSummary?: DetectionSummaryView;
  timestamp: string;
  compactMode?: boolean;
}

interface ClaimMatch {
  start: number;
  end: number;
  span: HallucinationSpan;
}

const riskToHighlightColors: Record<RiskLevel, string> = {
  none: "",
  green: "bg-green-500/18 text-green-700 dark:text-green-300 border-green-500/30",
  amber: "bg-amber-500/18 text-amber-700 dark:text-amber-300 border-amber-500/30",
  red: "bg-red-500/18 text-red-700 dark:text-red-300 border-red-500/30",
};

function formatScore(score?: number): string {
  if (typeof score !== "number" || Number.isNaN(score)) return "N/A";
  return `${score.toFixed(1)}/100`;
}

function formatConfidence(confidence?: number): string {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return "N/A";
  return confidence.toFixed(6);
}

function formatList(values?: string[]): string {
  if (!values || values.length === 0) return "N/A";
  return values.join(", ");
}

function buildClaimMatches(content: string, spans?: HallucinationSpan[]): ClaimMatch[] {
  if (!spans || spans.length === 0) return [];

  const lowerContent = content.toLowerCase();
  const allMatches: ClaimMatch[] = [];

  for (const span of spans) {
    const rawTarget = (span.exactQuote || span.text || "").trim();
    if (!rawTarget) continue;

    const target = rawTarget.toLowerCase();
    let startIndex = lowerContent.indexOf(target);

    while (startIndex !== -1) {
      allMatches.push({
        start: startIndex,
        end: startIndex + rawTarget.length,
        span,
      });
      startIndex = lowerContent.indexOf(target, startIndex + Math.max(target.length, 1));
    }
  }

  allMatches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - b.start - (a.end - a.start);
  });

  const selected: ClaimMatch[] = [];
  for (const candidate of allMatches) {
    const overlaps = selected.some(
      (picked) => candidate.start < picked.end && candidate.end > picked.start
    );
    if (!overlaps) selected.push(candidate);
  }

  selected.sort((a, b) => a.start - b.start);
  return selected;
}

function ClaimHoverCard({ text, span }: { text: string; span: HallucinationSpan }) {
  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          "inline rounded px-1 py-0.5 border cursor-help transition-colors hover:brightness-110",
          riskToHighlightColors[span.risk]
        )}
      >
        {text}
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        className="bg-tooltip text-pri border-strong text-xs shadow-lg max-w-[460px]"
      >
        <div className="space-y-1.5 leading-relaxed">
          <p><strong>claim_id:</strong> {span.claimId}</p>
          <p><strong>text:</strong> {span.text}</p>
          <p><strong>exact_quote:</strong> {span.exactQuote || "N/A"}</p>
          <p><strong>domain:</strong> {span.domain || "N/A"}</p>
          <p><strong>risk_score:</strong> {formatScore(span.riskScore)}</p>
          <p><strong>status:</strong> {span.status || "N/A"}</p>
          <p><strong>confidence:</strong> {formatConfidence(span.confidence)}</p>
          <p><strong>reasoning:</strong> {span.reasoning || "N/A"}</p>
          <p><strong>suggestion:</strong> {span.suggestion || "N/A"}</p>
          <p><strong>suggested_sources:</strong> {formatList(span.suggestedSources)}</p>
          <p><strong>citations:</strong> {formatList(span.citations)}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function ChatMessageBubble({
  role,
  content,
  spans,
  detectionSummary,
  timestamp,
  compactMode,
}: MessageProps) {
  const isUser = role === "user";
  const [showDetails, setShowDetails] = useState(false);

  const matches = useMemo(() => buildClaimMatches(content, spans), [content, spans]);

  const renderAssistantContent = () => {
    if (!spans || spans.length === 0 || matches.length === 0) {
      return <div className="whitespace-pre-wrap break-words leading-relaxed">{content}</div>;
    }

    const nodes: ReactNode[] = [];
    let cursor = 0;

    for (let i = 0; i < matches.length; i += 1) {
      const match = matches[i];
      if (cursor < match.start) {
        nodes.push(
          <span key={`plain-${i}-${cursor}`}>{content.slice(cursor, match.start)}</span>
        );
      }

      const claimText = content.slice(match.start, match.end);
      nodes.push(<ClaimHoverCard key={`claim-${i}-${match.start}`} text={claimText} span={match.span} />);
      cursor = match.end;
    }

    if (cursor < content.length) {
      nodes.push(<span key={`plain-end-${cursor}`}>{content.slice(cursor)}</span>);
    }

    return (
      <TooltipProvider delay={120}>
        <div className="whitespace-pre-wrap break-words leading-relaxed">{nodes}</div>
      </TooltipProvider>
    );
  };

  return (
    <div
      className={cn(
        "flex w-full gap-3 transition-opacity",
        compactMode ? "mt-4" : "mt-6",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <Avatar className={cn("shrink-0 mt-0.5 shadow-sm", compactMode ? "h-6 w-6" : "h-8 w-8")}>
          <AvatarFallback className="bg-tooltip text-sec uppercase text-[10px] font-medium tracking-wider">
            AI
          </AvatarFallback>
        </Avatar>
      )}

      <div className={cn("flex flex-col gap-1.5", isUser ? "items-end max-w-[75%]" : "items-start max-w-[75%]")}>
        <div
          className={cn(
            "relative leading-relaxed border shadow-sm",
            compactMode ? "text-xs px-3.5 py-2.5" : "text-sm px-5 py-3.5",
            isUser
              ? "bg-msg-user text-pri border-subtle rounded-2xl rounded-tr-sm"
              : "bg-msg-ai text-pri/90 border-0 rounded-2xl rounded-tl-sm"
          )}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap break-words leading-relaxed">{content}</div>
          ) : (
            renderAssistantContent()
          )}
        </div>

        {!isUser && (
          <div className="flex items-center gap-2 mt-1 pl-1 w-full pr-1">
            <TooltipProvider delay={0}>
              <Tooltip>
                <TooltipTrigger
                  className={cn(
                    "inline-flex items-center justify-center p-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-strong",
                    showDetails ? "text-pri bg-hover" : "text-mut hover:text-pri hover:bg-hover"
                  )}
                  onClick={() => setShowDetails((prev) => !prev)}
                >
                  {showDetails ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-tooltip text-pri border-strong text-xs shadow-lg">
                  <p>{showDetails ? "Hide Analysis" : "View Analysis"}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <span className="text-[10px] text-mut ml-auto">{timestamp}</span>
          </div>
        )}

        {!isUser && showDetails && (
          <div className="mt-2 p-4 rounded-xl border border-strong bg-pane/60 shadow-inner w-full max-w-full">
            <h4 className="text-xs font-semibold text-pri mb-2">Detection Summary</h4>
            <div className="text-[11px] text-sec/95 space-y-1.5 border border-subtle rounded-lg p-3 bg-hover/40">
              <p><strong>response_id:</strong> {detectionSummary?.responseId || "N/A"}</p>
              <p><strong>overall_risk_score:</strong> {formatScore(detectionSummary?.overallRiskScore)}</p>
              <p>
                <strong>risk_level:</strong>{" "}
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase font-semibold"
                  style={{ borderColor: detectionSummary?.riskColor || "#6B7280", color: detectionSummary?.riskColor || undefined }}
                >
                  {detectionSummary?.riskLevel || "N/A"}
                </Badge>
              </p>
              <p><strong>risk_color:</strong> {detectionSummary?.riskColor || "N/A"}</p>
              <p><strong>warning_message:</strong> {detectionSummary?.warningMessage || "N/A"}</p>
              <p><strong>results:</strong> {detectionSummary?.resultsPresent ? "present" : "null"}</p>
            </div>

            <h5 className="text-xs font-semibold text-pri mt-4 mb-2">warnings</h5>
            {detectionSummary?.warnings && detectionSummary.warnings.length > 0 ? (
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {detectionSummary.warnings.map((warning, idx) => (
                  <div key={`warning-${idx}`} className="rounded-lg border border-subtle bg-hover/50 p-2.5 text-[11px] text-sec/95 space-y-1">
                    <p><strong>type:</strong> {warning.type}</p>
                    <p><strong>message:</strong> {warning.message}</p>
                    <p><strong>claim_id:</strong> {warning.claimId}</p>
                    <p><strong>source_url:</strong> {warning.sourceUrl || "N/A"}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-mut">No warnings returned.</p>
            )}

            <h5 className="text-xs font-semibold text-pri mt-4 mb-2">claims</h5>
            {spans && spans.length > 0 ? (
              <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                {spans.map((span) => (
                  <div key={span.claimId} className="rounded-lg border border-subtle bg-hover/50 p-3 text-[11px] text-sec/95 space-y-1.5">
                    <p><strong>id:</strong> {span.claimId}</p>
                    <p><strong>text:</strong> {span.text}</p>
                    <p><strong>exact_quote:</strong> {span.exactQuote || "N/A"}</p>
                    <p><strong>domain:</strong> {span.domain || "N/A"}</p>
                    <p><strong>risk_score:</strong> {formatScore(span.riskScore)}</p>
                    <p><strong>status:</strong> {span.status || "N/A"}</p>
                    <p><strong>confidence:</strong> {formatConfidence(span.confidence)}</p>
                    <p><strong>reasoning:</strong> {span.reasoning || "N/A"}</p>
                    <p><strong>suggestion:</strong> {span.suggestion || "N/A"}</p>
                    <p><strong>suggested_sources:</strong> {formatList(span.suggestedSources)}</p>
                    <p><strong>note:</strong> {span.note || "N/A"}</p>
                    <p><strong>citations:</strong> {formatList(span.citations)}</p>

                    <div className="mt-2 rounded-md border border-subtle bg-pane/70 p-2 space-y-1">
                      <p><strong>verification_details.entailment_score:</strong> {span.verificationDetails?.entailmentScore ?? "N/A"}</p>
                      <p><strong>verification_details.contradiction_score:</strong> {span.verificationDetails?.contradictionScore ?? "N/A"}</p>
                      <p><strong>verification_details.neutral_score:</strong> {span.verificationDetails?.neutralScore ?? "N/A"}</p>
                      <p><strong>verification_details.source_coverage:</strong> {span.verificationDetails?.sourceCoverage ?? "N/A"}</p>
                      <p><strong>verification_details.source_agreement_variance:</strong> {span.verificationDetails?.sourceAgreementVariance ?? "N/A"}</p>
                      <p><strong>verification_details.sources_checked:</strong> {formatList(span.verificationDetails?.sourcesChecked)}</p>
                    </div>

                    <div className="space-y-2 mt-2">
                      <p><strong>verification_details.evidence:</strong></p>
                      {span.verificationDetails?.evidence && span.verificationDetails.evidence.length > 0 ? (
                        span.verificationDetails.evidence.map((evidence, evidenceIndex) => (
                          <div key={`${span.claimId}-evidence-${evidenceIndex}`} className="rounded-md border border-subtle bg-pane/60 p-2 space-y-1">
                            <p><strong>source_type:</strong> {evidence.sourceType}</p>
                            <p><strong>source_tier:</strong> {evidence.sourceTier || "N/A"}</p>
                            <p><strong>source_url:</strong> {evidence.sourceUrl || "N/A"}</p>
                            <p><strong>source_title:</strong> {evidence.sourceTitle || "N/A"}</p>
                            <p><strong>document_name:</strong> {evidence.documentName || "N/A"}</p>
                            <p><strong>chunk_index:</strong> {evidence.chunkIndex ?? "N/A"}</p>
                            <p><strong>message_index:</strong> {evidence.messageIndex ?? "N/A"}</p>
                            <p><strong>snippet:</strong> {evidence.snippet || "N/A"}</p>
                            <p><strong>nli_label:</strong> {evidence.nliLabel || "N/A"}</p>
                            <p>
                              <strong>nli_scores:</strong>{" "}
                              {evidence.nliScores ? JSON.stringify(evidence.nliScores) : "N/A"}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p>No evidence returned.</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-mut">No claims returned.</p>
            )}

            <h5 className="text-xs font-semibold text-pri mt-4 mb-2">metadata</h5>
            <div className="text-[11px] text-sec/95 space-y-1 border border-subtle rounded-lg p-3 bg-hover/40">
              <p><strong>processing_time_ms:</strong> {detectionSummary?.metadata?.processingTimeMs ?? "N/A"}</p>
              <p><strong>claims_extracted:</strong> {detectionSummary?.metadata?.claimsExtracted ?? "N/A"}</p>
              <p><strong>claims_verified:</strong> {detectionSummary?.metadata?.claimsVerified ?? "N/A"}</p>
              <p><strong>claims_skipped:</strong> {detectionSummary?.metadata?.claimsSkipped ?? "N/A"}</p>
              <p><strong>sources_queried:</strong> {formatList(detectionSummary?.metadata?.sourcesQueried)}</p>
              <p><strong>platform:</strong> {detectionSummary?.metadata?.platform || "N/A"}</p>
              <p><strong>conversation_id:</strong> {detectionSummary?.metadata?.conversationId || "N/A"}</p>
            </div>
          </div>
        )}

        {isUser && <span className="text-[10px] text-mut px-1 text-right w-full">{timestamp}</span>}
      </div>

      {isUser && (
        <Avatar className={cn("shrink-0 mt-0.5 ring-1 ring-subtle shadow-sm", compactMode ? "h-6 w-6" : "h-8 w-8")}>
          <AvatarFallback className="bg-hover text-sec uppercase text-[10px] font-medium tracking-wider">US</AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}
