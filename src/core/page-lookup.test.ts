import { describe, expect, it } from "vitest"
import { pageTextByIndex } from "./page-lookup"

describe("pageTextByIndex", () => {
  it("uses the explicit PDF page index instead of array position", () => {
    expect(
      pageTextByIndex(
        [
          { pageIndex: 4, text: "第五页", markdown: "" },
          { pageIndex: 9, text: "第十页", markdown: "" },
        ],
        9,
      ),
    ).toBe("第十页")
  })

  it("returns empty text for missing pages", () => {
    expect(pageTextByIndex([{ pageIndex: 2, text: "第三页", markdown: "" }], 0)).toBe("")
  })
})
