import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessageBubble } from "./chat-message-bubble";
import type { MessageProps } from "./chat-message-bubble";
import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface ChatMessageListProps {
  messages: MessageProps[];
  compactMode?: boolean;
  isThinking?: boolean;
}

export function ChatMessageList({ messages, compactMode, isThinking }: ChatMessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

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
              
              {isThinking && (
                <motion.div
                  initial={{ opacity: 0, y: 15, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className={cn("flex w-full gap-3 transition-opacity justify-start origin-left", compactMode ? "mt-4" : "mt-6")}
                >
                  <Avatar className={cn("shrink-0 mt-0.5 shadow-sm ring-1 ring-primary/20", compactMode ? "h-6 w-6" : "h-8 w-8")}>
                    <AvatarFallback className="bg-tooltip text-sec uppercase text-[10px] font-medium tracking-wider">AI</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col gap-1.5 items-start max-w-[75%]">
                    <div
                      className={cn(
                        "relative leading-relaxed shadow-sm flex items-center gap-3 overflow-hidden",
                        compactMode ? "text-xs px-3.5 py-2.5" : "text-sm px-5 py-3.5",
                        "bg-msg-ai text-pri border border-primary/5 rounded-2xl rounded-tl-sm font-medium"
                      )}
                    >
                      <motion.div 
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent"
                        animate={{ x: ['-200%', '200%'] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                      />
                      <span className="bg-gradient-to-r from-pri to-pri/60 bg-clip-text text-transparent pr-1">Detecting hallucinations</span>
                      <div className="flex space-x-1.5 items-center">
                        {[0, 1, 2].map((i) => (
                          <motion.div
                            key={i}
                            className="w-1.5 h-1.5 bg-pri/70 rounded-full"
                            animate={{ 
                              y: [0, -5, 0],
                              scale: [0.8, 1.2, 0.8],
                              opacity: [0.3, 1, 0.3]
                            }}
                            transition={{ 
                              duration: 0.8, 
                              repeat: Infinity, 
                              ease: "easeInOut", 
                              delay: i * 0.15 
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
          </div>
        )}
        <div ref={endRef} className="h-[2px]" />
      </div>
    </ScrollArea>
  );
}
