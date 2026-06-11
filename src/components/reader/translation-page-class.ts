import { cn } from "@/lib/utils"

export function translationPageClassName(pageIndex: number, totalPages: number) {
  return cn(
    "absolute left-0 right-0",
    pageIndex === 0 && "pt-0",
    pageIndex === Math.max(0, totalPages - 1) && "pb-0",
  )
}

export function translationSourceSurfaceClassName(pageIndex: number, totalPages: number) {
  return cn(
    "relative grid w-full grid-cols-1 bg-[var(--reader-surface-bg)] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
    pageIndex === 0 && "pt-10",
    pageIndex === Math.max(0, totalPages - 1) && "pb-12",
  )
}
