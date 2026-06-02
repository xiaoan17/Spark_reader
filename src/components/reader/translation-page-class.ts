import { cn } from "@/lib/utils"

export function translationPageClassName(pageIndex: number, totalPages: number) {
  return cn(
    "absolute left-0 right-0 grid grid-cols-2 overflow-hidden bg-card",
    pageIndex === 0 && "pt-4",
    pageIndex === Math.max(0, totalPages - 1) && "pb-4",
  )
}
