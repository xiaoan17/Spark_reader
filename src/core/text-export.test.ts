import { describe, expect, it } from "vitest"
import { buildTextAssetContent, makeTextAssetFilename } from "./text-export"

describe("text asset export", () => {
  it("creates safe converted text filenames", () => {
    expect(makeTextAssetFilename("财富公式.pdf", "md")).toBe("财富公式.md")
    expect(makeTextAssetFilename('a/b:c*"?<>|', "txt")).toBe("a-b-c------.txt")
    expect(makeTextAssetFilename("   ", "md")).toBe("converted-book.md")
  })

  it("builds reusable txt and markdown assets from converted pages", () => {
    const pages = [
      { pageIndex: 0, text: "第一页纯文本", markdown: "# 第一页\n\n第一页 Markdown" },
      { pageIndex: 1, text: "第二页纯文本", markdown: "" },
    ]

    expect(buildTextAssetContent(pages, "txt")).toBe("第一页纯文本\n\n第二页纯文本")
    expect(buildTextAssetContent(pages, "md")).toBe("# 第一页\n\n第一页 Markdown\n\n第二页纯文本")
  })
})
