import { cn } from "@/lib/utils"

type ProgressProps = {
  value: number
  className?: string
}

export function Progress({ value, className }: ProgressProps) {
  const bounded = Math.max(0, Math.min(100, value))

  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className="h-full bg-primary transition-all"
        style={{ width: `${bounded}%` }}
      />
    </div>
  )
}
