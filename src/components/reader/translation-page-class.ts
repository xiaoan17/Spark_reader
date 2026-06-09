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
    "relative w-full max-w-3xl bg-card px-10 py-3",
    pageIndex === 0 && "pt-10",
    pageIndex === Math.max(0, totalPages - 1) && "pb-12",
  )
}
