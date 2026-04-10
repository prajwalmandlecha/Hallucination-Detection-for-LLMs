import { useState, useRef, useEffect } from "react";
import { CornerUpRight, Paperclip, Check, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useKnowledgeBase } from "@/hooks/use-knowledge-base";

interface ChatInputProps {
  onSendMessage: (message: string, documentIds: string[]) => void;
  isLoading?: boolean;
}

export function ChatInput({ onSendMessage, isLoading }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const { documents } = useKnowledgeBase();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "inherit";
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollHeight, 200)}px`;
    }
  }, [input]);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSend = () => {
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim(), Array.from(selectedDocs));
      setInput("");
      setIsMenuOpen(false);
      if (textareaRef.current) {
        textareaRef.current.style.height = "inherit";
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleDocSelection = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="relative flex flex-col w-full max-w-3xl mx-auto gap-2">
      {/* Document Selection Dropdown Menu */}
      {isMenuOpen && (
        <div 
          ref={menuRef}
          className="absolute bottom-full left-0 mb-3 w-72 bg-popover text-popover-foreground border border-border-subtle rounded-xl shadow-lg z-50 overflow-hidden text-sm flex flex-col max-h-64"
        >
          <div className="px-3 py-2 font-semibold text-xs text-muted-foreground uppercase tracking-wider border-b border-border-subtle bg-muted/30">
            Fact-Check Against
          </div>
          <div className="flex flex-col overflow-y-auto p-1">
            {documents.length === 0 ? (
              <div className="px-3 py-4 text-center text-muted-foreground text-xs">
                No documents found. Add them in the Knowledge Base (Sidebar).
              </div>
            ) : (
              documents.map((doc) => {
                const isSelected = selectedDocs.has(doc.id);
                return (
                  <button
                    key={doc.id}
                    onClick={(e) => toggleDocSelection(doc.id, e)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-left hover:bg-hover hover:text-pri transition-colors group"
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? "bg-pri border-pri text-background" : "border-border-subtle group-hover:border-pri/50"}`}>
                      {isSelected && <Check className="w-3 h-3" />}
                    </div>
                    <FileText className="w-4 h-4 text-muted-foreground group-hover:text-pri/70" />
                    <span className="flex-1 truncate">{doc.filename}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Selected Documents Badges */}
      {selectedDocs.size > 0 && (
        <div className="flex flex-wrap gap-2 px-2 -mb-1 relative z-10 w-full items-center">
          <span className="text-[10px] uppercase font-bold text-pri/70 pr-1 tracking-wider border-r border-border-subtle/50">Verifying Against:</span>
          {Array.from(selectedDocs).map(docId => {
            const doc = documents.find(d => d.id === docId);
            if (!doc) return null;
            return (
              <div key={docId} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-pri/10 border border-pri/20 text-pri text-[11px] font-medium leading-none">
                <FileText className="w-3 h-3 opacity-70" />
                <span className="truncate max-w-[120px]">{doc.filename}</span>
                <button 
                  onClick={(e) => toggleDocSelection(docId, e)}
                  className="hover:text-foreground text-pri/60 hover:bg-pri/20 rounded-full p-0.5 transition-colors"
                >
                  <Check className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Input Field Container */}
      <div className={`relative flex w-full items-end gap-2 bg-card backdrop-blur-xl ${selectedDocs.size > 0 ? "rounded-b-[24px] rounded-t-xl" : "rounded-[24px]"} p-2 pr-3 pl-3 border border-border/30 shadow-[0_4px_24px_rgba(0,0,0,0.08)] focus-within:border-border/60 focus-within:shadow-[0_6px_32px_rgba(0,0,0,0.12)] transition-all overflow-hidden duration-300`}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className={`relative z-10 shrink-0 ${selectedDocs.size > 0 || isMenuOpen ? "text-pri bg-pri/10 border border-pri/20" : "text-sec hover:text-pri hover:bg-hover border transform-none border-transparent"} rounded-lg h-9 w-9 transition-colors`}
          title="Fact-Check Settings"
        >
          <Paperclip className="h-5 w-5" />
        </Button>
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything..."
          className="relative z-10 min-h-[36px] max-h-[200px] w-full resize-none border-0 bg-transparent py-2 px-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 overflow-y-auto m-0 outline-none"
          rows={1}
        />
        <Button
          disabled={!input.trim() || isLoading}
          onClick={handleSend}
          size="icon"
          className="relative z-10 shrink-0 rounded-[12px] h-9 w-9 bg-foreground hover:opacity-85 text-background disabled:bg-muted disabled:text-muted-foreground disabled:opacity-40 transition-all"      
        >
          <CornerUpRight className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
