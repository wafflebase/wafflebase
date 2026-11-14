import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Multi-line sibling of `Input`: the same `input-border` edge (≥3:1, WCAG
 * 1.4.11), syrup caret, focus ring and invalid state, so a textarea in a
 * dialog reads as the same kind of control as the field above it.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "caret-primary placeholder:text-muted-foreground dark:bg-input/30 border-input-border flex min-h-16 w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
