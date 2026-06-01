import { describe, expect, it } from "vitest"
import { highlightSaveFeedback } from "./highlight-save-feedback"

describe("highlightSaveFeedback", () => {
  it("reports PDF geometry highlight only after persistence succeeds", () => {
    expect(
      highlightSaveFeedback({
        hasBook: true,
        saved: true,
        selectionRects: [{ pageIndex: 0, x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.3 }],
      }),
    ).toBe("已保存 PDF 几何高亮和文本锚点")
  })

  it("reports text highlight only after persistence succeeds", () => {
    expect(
      highlightSaveFeedback({
        hasBook: true,
        saved: true,
        selectionRects: [],
      }),
    ).toBe("已保存转换稿文本高亮")
  })

  it("does not claim success when persistence fails", () => {
    expect(
      highlightSaveFeedback({
        hasBook: true,
        saved: false,
        selectionRects: [],
      }),
    ).toBe("高亮保存失败，请检查书库状态")
    expect(
      highlightSaveFeedback({
        hasBook: false,
        saved: false,
        selectionRects: [],
      }),
    ).toBe("当前运行环境暂未写入本地库")
  })
})
