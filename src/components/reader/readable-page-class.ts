import { cn } from "@/lib/utils"

export function readablePageClassName(pageIndex: number, totalPages: number, verticalPadding = "py-8") {
  return cn(
    "absolute left-0 right-0 px-4 sm:px-6 md:px-8",
    verticalPadding,
    pageIndex === Math.max(0, totalPages - 1) && "pb-16",
  )
}
