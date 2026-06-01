import type { LibraryStatus } from "@/stores/reader-store"

export function shouldUseBackendInterpretation({
  bookId,
  libraryStatus,
  tauriRuntime,
}: {
  bookId: string
  libraryStatus: LibraryStatus
  tauriRuntime: boolean
}) {
  return tauriRuntime && Boolean(bookId) && libraryStatus === "indexed"
}
