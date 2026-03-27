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
    <ScrollArea className="flex-1 w-full h-full pb-4">
      <div className={cn("flex flex-col gap-6 justify-end mx-auto px-4 w-full h-full", !compactMode && "max-w-4xl py-8")}>
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col justify-center items-center text-center text-[#75757c] font-light mt-20 px-8">
            <p className="text-sm">Initiate conversation to stream model analysis.</p>
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
