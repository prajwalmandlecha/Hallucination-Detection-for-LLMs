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
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
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

  const formatScore = (score?: number) => (typeof score === "number" ? `${score.toFixed(1)}/100` : "N/A");

  const formatCitations = (citations?: string[]) =>
    citations && citations.length > 0
      ? citations.join(" | ")
      : "No citations returned by backend for this claim yet.";

  // A very simple regex replacer if spans are provided to highlight text.
  // In a real app, this would be an exact token mapper. For now, it highlights if text matches.
  const renderContent = () => {
    if (isUser) return content;
    return (
      <div className="prose dark:prose-invert prose-sm max-w-none break-words prose-p:leading-relaxed prose-pre:p-0">
        <Streamdown>{content}</Streamdown>
      </div>
    );
  };

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

        {/* AI Actions Row */
        !isUser && (
          <div className="flex items-center gap-2 mt-1 pl-1 w-full flex-wrap pr-1">
            {spans && spans.some((s) => s.risk !== "none") && (
              <div className="flex gap-1.5 flex-wrap">
                {spans.filter((s) => s.risk !== "none").map((badSpan, idx) => (
                  <TooltipProvider key={idx} delay={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
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
