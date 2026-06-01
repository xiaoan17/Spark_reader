import type { LibraryStatus } from "@/stores/reader-store"

export type EmbeddingSaveIndexAction = "rebuild-current-book" | "refresh-only"

export function embeddingSaveIndexAction({
  bookId,
  libraryStatus,
  tauriRuntime,
}: {
  bookId: string
  libraryStatus: LibraryStatus
  tauriRuntime: boolean
}): EmbeddingSaveIndexAction {
  if (!tauriRuntime || !bookId || libraryStatus !== "indexed") {
    return "refresh-only"
  }
  return "rebuild-current-book"
}
