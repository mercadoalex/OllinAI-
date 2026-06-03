import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "low" | "medium" | "high" | "critical"
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        {
          "border-transparent bg-primary text-primary-foreground": variant === "default",
          "border-transparent bg-secondary text-secondary-foreground": variant === "secondary",
          "border-transparent bg-destructive text-destructive-foreground": variant === "destructive",
          "text-foreground": variant === "outline",
          "border-transparent bg-emerald-100 text-emerald-700": variant === "low",
          "border-transparent bg-amber-100 text-amber-700": variant === "medium",
          "border-transparent bg-orange-100 text-orange-700": variant === "high",
          "border-transparent bg-red-100 text-red-700": variant === "critical",
        },
        className
      )}
      {...props}
    />
  )
}

export { Badge }
