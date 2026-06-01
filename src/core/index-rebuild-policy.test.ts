import { describe, expect, it } from "vitest"
import { embeddingSaveIndexAction } from "./index-rebuild-policy"

describe("embedding save index policy", () => {
  it("rebuilds the current persisted desktop book after embedding settings change", () => {
    expect(
      embeddingSaveIndexAction({
        bookId: "book-1",
        libraryStatus: "indexed",
        tauriRuntime: true,
      }),
    ).toBe("rebuild-current-book")
  })

  it("refreshes only when there is no persisted desktop index to rebuild", () => {
    expect(
      embeddingSaveIndexAction({
        bookId: "",
        libraryStatus: "idle",
        tauriRuntime: true,
      }),
    ).toBe("refresh-only")
    expect(
      embeddingSaveIndexAction({
        bookId: "book-1",
        libraryStatus: "memory-only",
        tauriRuntime: true,
      }),
    ).toBe("refresh-only")
    expect(
      embeddingSaveIndexAction({
        bookId: "book-1",
        libraryStatus: "indexed",
        tauriRuntime: false,
      }),
    ).toBe("refresh-only")
  })
})
