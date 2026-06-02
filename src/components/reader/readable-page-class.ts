import { cn } from "@/lib/utils"

export function readablePageClassName(pageIndex: number, totalPages: number, verticalPadding = "py-3") {
  return cn(
    "absolute left-0 right-0 px-10",
    verticalPadding,
    pageIndex === 0 && "pt-10",
    pageIndex === Math.max(0, totalPages - 1) && "pb-12",
  )
}
