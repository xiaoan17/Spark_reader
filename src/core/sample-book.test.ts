import { describe, expect, it } from "vitest"
import { createSampleBook } from "./sample-book"

describe("sample book", () => {
  it("opens with a ready text selection and local evidence", () => {
    const sample = createSampleBook()

    expect(sample.title).toBe("框选精读示例书")
    expect(sample.pages.length).toBeGreaterThan(1)
    expect(sample.chunks.length).toBeGreaterThan(sample.pages.length)
    expect(sample.metadata.parserEngine).toBe("sample-converted-text")
    expect(sample.metadata.coordinateMode).toBe("text-only")
    expect(sample.initialSelection.text).toContain("证据段落")
    expect(sample.initialSelection.text).not.toContain("chunk_id")
    expect(sample.pages[0].text.slice(
      sample.initialSelection.anchor.positionStart,
      sample.initialSelection.anchor.positionEnd,
    )).toBe(sample.initialSelection.text)
    expect(sample.evidence.map((item) => item.chunkId)).toContain("sample-p1-c1")
    expect(sample.interpretation).toContain("[sample-p1-c2]")
    expect(sample.interpretation).not.toContain("chunk_id")
    expect(sample.agentTrace.map((step) => step.phase)).toEqual(["plan", "synthesize"])
  })
})
