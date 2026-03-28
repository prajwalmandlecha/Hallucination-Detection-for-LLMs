import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessageBubble } from "./chat-message-bubble";
import type { MessageProps } from "./chat-message-bubble";
import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface ChatMessageListProps {
  messages: MessageProps[];
  compactMode?: boolean;
}

export function ChatMessageList({ messages, compactMode }: ChatMessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <ScrollArea className="h-full w-full pr-4">
      <div className={cn("flex flex-col mx-auto px-4 w-full pb-4", !compactMode && "max-w-4xl py-8", messages.length === 0 && "h-full")}>
        {messages.length === 0 ? (
          <div className="flex flex-col justify-center items-center text-center text-mut font-light h-full min-h-[400px]">
            <p className="text-xl font-medium text-pri mb-2 relative z-10">System Ready</p>
            <p className="text-sm text-mut relative z-10">Initiate conversation to begin hallucination analysis.</p>
          </div>
        ) : (
          <div className={cn("flex flex-col w-full", compactMode ? "gap-4 mt-4" : "gap-6")}>
             {messages.map((msg) => (
                <ChatMessageBubble
                  key={msg.id}
                  id={msg.id}
                  role={msg.role}
                  content={msg.content}
                  spans={msg.spans}
                  timestamp={msg.timestamp}
                  compactMode={compactMode}
                />
              ))}
          </div>
        )}
        <div ref={endRef} className="h-[2px]" />
      </div>
    </ScrollArea>
  );
}
