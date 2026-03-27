import React from "react";
import { cn } from "@/lib/utils";

export type RiskLevel = "none" | "green" | "amber" | "red";

export interface SidebarItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
  snippet?: string;
  riskLevel?: RiskLevel;
}

const riskColorMap = {
  none: "bg-transparent",
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

export const SidebarItem = React.forwardRef<HTMLButtonElement, SidebarItemProps>(
  ({ title, snippet, riskLevel = "none", className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "w-full flex-col items-start text-left transition-all h-auto cursor-pointer block overflow-hidden", // Strict overflow and block layout
          className
        )}
        {...props}
      >
        <div className="flex justify-between items-center w-full relative">
          <span className="font-semibold truncate block text-[13px] leading-tight text-pri flex-1 pr-3">
            {title}
          </span>
          {riskLevel !== "none" && (
            <div
              className={cn(
                "w-2 h-2 rounded-full flex-shrink-0 ml-2 shadow-[0_0_8px_rgba(0,0,0,0.5)]",
                riskColorMap[riskLevel],
                riskLevel === "green" && "shadow-green-500/20",
                riskLevel === "amber" && "shadow-amber-500/20",
                riskLevel === "red" && "shadow-red-500/20"
              )}
            />
          )}
        </div>
        {snippet && (
          <p className="w-full text-[11.5px] truncate mt-1.5 text-sec transition-colors leading-tight font-medium">
            {snippet}
          </p>
        )}
      </button>
    );
  }
);
SidebarItem.displayName = "SidebarItem";
