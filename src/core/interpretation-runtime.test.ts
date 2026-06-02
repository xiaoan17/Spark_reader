import { describe, expect, it } from "vitest"
import { llmKeyReadiness, shouldUseBackendInterpretation } from "./interpretation-runtime"

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

describe("llmKeyReadiness", () => {
  it("allows backend interpretation when the active provider has a saved key", () => {
    expect(
      llmKeyReadiness({
        provider: "deep_seek",
        model: "deepseek-v4-flash",
        apiKeyConfigured: true,
      }),
    ).toEqual({ ready: true })
  })

  it("returns an actionable local fallback message when the key is missing", () => {
    const readiness = llmKeyReadiness({
      provider: "open_ai",
      model: "gpt-5-mini",
      apiKeyConfigured: false,
    }, "追问")

    expect(readiness.ready).toBe(false)
    if (!readiness.ready) {
      expect(readiness.reason).toBe("missing_api_key")
      expect(readiness.message).toContain("OpenAI")
      expect(readiness.message).toContain("gpt-5-mini")
      expect(readiness.message).toContain("本地兜底")
      expect(readiness.message).toContain("完整 LLM 追问")
    }
  })
})
