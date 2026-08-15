import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg bg-muted px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:bg-muted/70 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:bg-destructive/10 md:text-sm dark:bg-input/40 dark:focus-visible:bg-input/60 dark:aria-invalid:bg-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
