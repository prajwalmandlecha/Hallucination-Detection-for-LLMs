import { useState } from "react";
import { ChatSidebarContainer } from "@/components/sidebar/sidebar-container";
import { ChatContainer } from "@/components/chat/chat-container";
import { SidebarProvider, SidebarInset } from "@/components/animate-ui/components/radix/sidebar";
import { ThemeProvider } from "@/components/theme-provider";

function App() {
  const [activeChatId, setActiveChatId] = useState<string>("chat-1");

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme" attribute="class">
      <SidebarProvider className="relative flex w-full h-screen bg-app transition-colors duration-500 text-foreground overflow-hidden font-sans">
      {/* Aurora animated background layer — absolute, non-layout-affecting */}
      <div className="absolute inset-0 overflow-hidden z-0 pointer-events-none">
        {/* Primary aurora blob */}
        <div
          className="absolute rounded-full"
          style={{
            width: "70%",
            height: "60%",
            top: "-10%",
            right: "-5%",
            backgroundImage: "radial-gradient(ellipse, var(--aurora-1-start) 0%, var(--aurora-1-mid) 40%, transparent 70%)",
            filter: "blur(80px)",
            animation: "aurora 12s ease-in-out infinite alternate",
          }}
        />
        {/* Secondary aurora blob */}
        <div
          className="absolute rounded-full"
          style={{
            width: "50%",
            height: "50%",
            bottom: "-10%",
            left: "10%",
            backgroundImage: "radial-gradient(ellipse, var(--aurora-2-start) 0%, var(--aurora-2-mid) 40%, transparent 70%)",
            filter: "blur(60px)",
            animation: "aurora 16s ease-in-out infinite alternate-reverse",
          }}
        />
      </div>

      {/* Sidebar + Main content — unaffected flex row layout */}
      <ChatSidebarContainer
        activeChatId={activeChatId}
        onChatSelect={setActiveChatId}
      />
      <SidebarInset className="relative flex-1 flex flex-col z-10 bg-transparent shadow-none border-none ring-0">
        <ChatContainer activeChatId={activeChatId} />
      </SidebarInset>
    </SidebarProvider>
    </ThemeProvider>
  );
}

export default App;
