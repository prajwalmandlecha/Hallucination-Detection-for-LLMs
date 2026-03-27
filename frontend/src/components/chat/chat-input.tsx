import { useState, useRef, useEffect } from "react";
import { CornerUpRight, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
interface ChatInputProps {
  onSendMessage: (message: string) => void;
  isLoading?: boolean;
}

export function ChatInput({ onSendMessage, isLoading }: ChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "inherit";
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSend = () => {
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim());
      setInput("");
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

  return (
    <div className="relative flex w-full max-w-3xl mx-auto items-end gap-2 bg-card backdrop-blur-xl rounded-[24px] p-2 pr-3 pl-3 border border-border/30 shadow-[0_4px_24px_rgba(0,0,0,0.08)] focus-within:border-border/60 focus-within:shadow-[0_6px_32px_rgba(0,0,0,0.12)] transition-all overflow-hidden duration-300">
      <Button
        variant="ghost"
        size="icon"
        className="relative z-10 shrink-0 text-sec hover:text-pri hover:bg-hover rounded-lg h-9 w-9"
      >
        <Paperclip className="h-5 w-5" />
      </Button>
      <Textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything or analyze a document..."
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
  );
}
