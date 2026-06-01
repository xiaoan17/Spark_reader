import type { ParsedPage } from "@/stores/reader-store"

export function pageTextByIndex(pages: ParsedPage[], pageIndex: number) {
  return pages.find((page) => page.pageIndex === pageIndex)?.text ?? ""
}
