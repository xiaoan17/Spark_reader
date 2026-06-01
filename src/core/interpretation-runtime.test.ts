import { describe, expect, it } from "vitest"
import { shouldUseBackendInterpretation } from "./interpretation-runtime"

describe("shouldUseBackendInterpretation", () => {
  it("uses backend RAG only for indexed desktop books", () => {
    expect(
      shouldUseBackendInterpretation({
        bookId: "book-1",
        libraryStatus: "indexed",
        tauriRuntime: true,
      }),
    ).toBe(true)
  })

  it("keeps browser and memory-only reading on local text fallback", () => {
    expect(
      shouldUseBackendInterpretation({
        bookId: "book-1",
        libraryStatus: "indexed",
        tauriRuntime: false,
      }),
    ).toBe(false)
    expect(
      shouldUseBackendInterpretation({
        bookId: "book-1",
        libraryStatus: "memory-only",
        tauriRuntime: true,
      }),
    ).toBe(false)
    expect(
      shouldUseBackendInterpretation({
        bookId: "",
        libraryStatus: "indexed",
        tauriRuntime: true,
      }),
    ).toBe(false)
  })
})
