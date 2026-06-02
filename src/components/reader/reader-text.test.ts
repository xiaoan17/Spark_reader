import { describe, expect, it } from "vitest"
import { cleanPdfLineBreaks } from "./reader-text"

describe("reader text helpers", () => {
  it("joins single-line PDF wraps inside a paragraph", () => {
    expect(cleanPdfLineBreaks("第一行\n第二行\n\nThird\nline")).toBe("第一行第二行\n\nThirdline")
  })

  it("normalizes Chinese punctuation spacing without flattening blank paragraphs", () => {
    expect(cleanPdfLineBreaks("第一句。第二句\n\n  第三句，第四句  ")).toBe(
      "第一句。 第二句\n\n第三句， 第四句",
    )
  })
})
