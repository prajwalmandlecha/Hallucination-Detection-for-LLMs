import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { useEffect, useRef, useState } from "react";
import Mark from "mark.js";
export type RiskLevel = "none" | "green" | "amber" | "red";

export interface HallucinationSpan {
  text: string;
  risk: RiskLevel;
  explanation?: string;
  score?: number;
  status?: "VERIFIED" | "UNVERIFIED" | "CONTRADICTED" | "SKIPPED";
  claimType?: string;
  claimId?: string;
  citations?: string[];
}

export interface MessageProps {
  id: string;
  role: "user" | "assistant";
  content: string;
  spans?: HallucinationSpan[]; 
  timestamp: string;
  compactMode?: boolean;
}

const riskToBadgeColors = {
  none: "bg-transparent text-transparent",
  green: "bg-green-500/10 text-green-500 border-green-500/20",
  amber: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  red: "bg-red-500/10 text-red-500 border-red-500/20",
};


export function ChatMessageBubble({ role, content, spans, timestamp, compactMode }: MessageProps) {
  const isUser = role === "user";
  const contentRef = useRef<HTMLDivElement>(null);
  const [hoveredSpanIndex, setHoveredSpanIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  useEffect(() => {
    if (!contentRef.current || !spans || spans.length === 0 || isUser) return;
    const ctx = contentRef.current;
    
    const instance = new Mark(ctx);
    instance.unmark({
      done: () => {
        const sortedSpans = spans
          .map((s, idx) => ({ ...s, originalIndex: idx }))
          .filter(s => s.risk !== "none")
          .sort((a, b) => b.text.length - a.text.length);

        sortedSpans.forEach(span => {
          instance.mark(span.text, {
            separateWordSearch: false,
            acrossElements: true,
            diacritics: false,
            accuracy: "partially", // allows matching despite minor punctuation differences
            className: cn(
              "cursor-help bg-transparent rounded-[2px] transition-all hover:opacity-80 px-1 inline pb-0.5",
              span.risk === "red"
                ? "bg-red-500/30 text-red-700 dark:bg-red-500/40 dark:text-red-300 border-b border-red-500"
                : span.risk === "amber"
                ? "bg-amber-500/30 text-amber-700 dark:bg-amber-500/40 dark:text-amber-300 border-b border-amber-500"
                : "bg-green-500/30 text-green-700 dark:bg-green-500/40 dark:text-green-300 border-b border-green-500"
            ),
            each: (elem) => {
              (elem as HTMLElement).dataset.spanIndex = span.originalIndex.toString();
            }
          });
        });
      }
    });

    return () => instance.unmark();
  }, [content, spans, isUser]);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!contentRef.current) return;
    const ctx = contentRef.current;

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName.toLowerCase() === "mark" && target.dataset.spanIndex !== undefined) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setHoveredSpanIndex(parseInt(target.dataset.spanIndex, 10));
        setTooltipPos({ x: e.clientX, y: e.clientY });
        setIsTooltipOpen(true);
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Use relatedTarget to prevent flickering when moving inside the mark
      const related = e.relatedTarget as HTMLElement;
      if (target.tagName.toLowerCase() === "mark" && (!related || related.tagName.toLowerCase() !== "mark")) {
        timeoutRef.current = setTimeout(() => setIsTooltipOpen(false), 200);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName.toLowerCase() === "mark") {
        setTooltipPos({ x: e.clientX, y: e.clientY });
      }
    };

    ctx.addEventListener("mouseover", handleMouseOver);
    ctx.addEventListener("mouseout", handleMouseOut);
    ctx.addEventListener("mousemove", handleMouseMove);

    return () => {
      ctx.removeEventListener("mouseover", handleMouseOver);
      ctx.removeEventListener("mouseout", handleMouseOut);
      ctx.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  const formatScore = (score?: number) => (typeof score === "number" ? `${score.toFixed(1)}/100` : "N/A");

  const formatCitations = (citations?: string[]) =>
    citations && citations.length > 0
      ? citations.join(" | ")
      : "No citations returned by backend for this claim yet.";

  const renderContent = () => {
    if (isUser) return content;
    return (
      <div ref={contentRef} className="prose dark:prose-invert prose-sm max-w-none break-words prose-p:leading-relaxed prose-pre:p-0 relative">
        <Streamdown>{content}</Streamdown>
      </div>
    );
  };

  const hoveredSpan = hoveredSpanIndex !== null && spans ? spans[hoveredSpanIndex] : null;

  return (
    <div className={cn("flex w-full gap-3 transition-opacity", compactMode ? "mt-4" : "mt-6", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <Avatar className={cn("shrink-0 mt-0.5 shadow-sm", compactMode ? "h-6 w-6" : "h-8 w-8")}>
          <AvatarFallback className="bg-tooltip text-sec uppercase text-[10px] font-medium tracking-wider">AI</AvatarFallback>
        </Avatar>
      )}

      <div className={cn("flex flex-col gap-1.5", isUser ? "items-end max-w-[75%]" : "items-start max-w-[75%]")}>
        <div
          className={cn(
            "relative leading-relaxed border shadow-sm",
            compactMode ? "text-xs px-3.5 py-2.5" : "text-sm px-5 py-3.5",
            isUser
              ? "bg-msg-user text-pri border-subtle rounded-2xl rounded-tr-sm"
              : "bg-msg-ai text-pri/80 border-0 rounded-2xl rounded-tl-sm"
          )}
        >
          {renderContent()}
        </div>

        {/* Floating Tooltip via HoverCard */
        hoveredSpan && (
          <HoverCard open={isTooltipOpen} defaultOpen={false}>
            <HoverCardTrigger render={<div 
                style={{ 
                  position: 'fixed', 
                  left: tooltipPos.x, 
                  top: tooltipPos.y, 
                  width: 1, 
                  height: 1,
                  pointerEvents: 'none',
                  zIndex: 9999
                }} 
              />} 
            />
            <HoverCardContent
              side="top"
              align="start"
              sideOffset={16}
              className="w-[300px] sm:w-[360px] bg-pane/95 backdrop-blur-md border-strong shadow-2xl p-4 flex flex-col gap-2 rounded-xl z-50 text-sans font-sans"
              onMouseEnter={() => {
                if (timeoutRef.current) clearTimeout(timeoutRef.current);
                setIsTooltipOpen(true);
              }}
              onMouseLeave={() => {
                timeoutRef.current = setTimeout(() => setIsTooltipOpen(false), 200);
              }}
            >
              <div className="flex items-center justify-between pointer-events-none">
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] uppercase font-bold tracking-wider",
                    riskToBadgeColors[hoveredSpan.risk]
                  )}
                >
                  {hoveredSpan.risk === "red"
                    ? "High Risk"
                    : hoveredSpan.risk === "amber"
                    ? "Unverified"
                    : "Verified"}
                </Badge>
                <span className="text-[11px] font-mono text-mut">
                  Score: {formatScore(hoveredSpan.score)}
                </span>
              </div>
              <p className="text-sm font-medium text-pri leading-snug break-words">
                "{hoveredSpan.text}"
              </p>
              {hoveredSpan.explanation && (
                <div className="text-xs text-sec bg-app/50 p-2.5 rounded-md border border-subtle mt-1 flex flex-col gap-1.5 break-words">
                  <span className="text-[10px] uppercase font-bold text-mut tracking-wider">
                    Explanation
                  </span>
                  {hoveredSpan.explanation}
                </div>
              )}
              <div className="text-xs mt-1 text-mut bg-app/30 p-2.5 rounded-md border border-subtle flex flex-col gap-1 break-words">
                <span className="text-[10px] uppercase font-bold text-mut tracking-wider">
                  Sources
                </span>
                {formatCitations(hoveredSpan.citations)}
              </div>
            </HoverCardContent>
          </HoverCard>
        )}

        {/* AI Actions Row */
        !isUser && (
          <div className="flex items-center gap-2 mt-1 pl-1 w-full flex-wrap pr-1">
            {spans && spans.some((s) => s.risk !== "none") && (
              <div className="flex gap-1.5 flex-wrap">
                {spans.filter((s) => s.risk !== "none").map((badSpan, idx) => (
                  <TooltipProvider key={idx} delay={0}>
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge variant="outline" className={cn("cursor-help text-[10px] uppercase font-medium tracking-wide border shadow-sm px-1.5 py-0 h-4", riskToBadgeColors[badSpan.risk])}>
                          {badSpan.risk === "red" ? "High Risk" : badSpan.risk === "amber" ? "Elevated Risk" : "Verified"}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="bg-tooltip text-pri border-strong text-xs shadow-lg max-w-[320px]">
                        <div className="space-y-1">
                          <p><strong>Score:</strong> {formatScore(badSpan.score)}</p>
                          <p><strong>Status:</strong> {badSpan.status || "N/A"}</p>
                          <p><strong>Type:</strong> {badSpan.claimType || "N/A"}</p>
                          <p><strong>Citations:</strong> {formatCitations(badSpan.citations)}</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
              </div>
            )}
            
            <Dialog>
              <TooltipProvider delay={0}>
                <Tooltip>
                  <DialogTrigger
                    render={
                      <TooltipTrigger className="inline-flex items-center justify-center p-1.5 rounded-md text-mut hover:text-pri hover:bg-hover transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-strong">
                        <Eye className="h-3.5 w-3.5" />
                      </TooltipTrigger>
                    }
                  />
                  <TooltipContent side="top" className="bg-tooltip text-pri border-strong text-xs shadow-lg">
                    <p>View Metrics</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <DialogContent className="bg-pane border border-strong text-pri sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Response Metrics</DialogTitle>
                  <DialogDescription className="text-sec">
                    Detailed hallucination and risk analysis for this generated output.
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                  {spans && spans.length > 0 ? (
                    spans.map((span, i) => (
                      <div key={`modal-${i}`} className="flex flex-col gap-1 p-3 rounded-lg border border-subtle bg-hover">
                        <div className="flex items-center gap-2 font-medium text-sm">
                          <Badge variant="outline" className={cn("text-[10px] uppercase font-semibold h-5", riskToBadgeColors[span.risk])}>
                             {span.risk.toUpperCase()}
                          </Badge>
                          <span className="truncate max-w-[200px] text-pri">"{span.text}"</span>
                        </div>
                        <p className="text-xs text-sec mt-1">{span.explanation || "No advanced explanation available."}</p>
                        <div className="text-[11px] text-sec/90 space-y-1 mt-2">
                          <p><strong>Score:</strong> {formatScore(span.score)}</p>
                          <p><strong>Status:</strong> {span.status || "N/A"}</p>
                          <p><strong>Type:</strong> {span.claimType || "N/A"}</p>
                          <p><strong>Claim ID:</strong> {span.claimId || "N/A"}</p>
                          <p><strong>Citations:</strong> {formatCitations(span.citations)}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-mut">No detected risk spans or metrics available for this response.</p>
                  )}
                </div>
              </DialogContent>
            </Dialog>

            <span className="text-[10px] text-mut ml-auto">{timestamp}</span>
          </div>
        )}

        {isUser && (
          <span className="text-[10px] text-mut px-1 text-right w-full">{timestamp}</span>
        )}
      </div>

      {isUser && (
        <Avatar className={cn("shrink-0 mt-0.5 ring-1 ring-subtle shadow-sm", compactMode ? "h-6 w-6" : "h-8 w-8")}>
          <AvatarFallback className="bg-hover text-sec uppercase text-[10px] font-medium tracking-wider">US</AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}
