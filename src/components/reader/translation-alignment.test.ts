import { describe, expect, it } from "vitest"
import {
  alignedTranslationRows,
  sanitizeDisplayedTranslationMarkdown,
  sourceBlockForTranslatedSelection,
  splitMarkdownBlocks,
} from "./translation-alignment"

describe("translation alignment", () => {
  it("keeps numbered translated blocks aligned to source block ids", () => {
    const rows = alignedTranslationRows(
      "Alpha paragraph.\n\nShort.\n\nSummary paragraph.",
      "[[B001]]\n第一段中文。\n\n[[B003]]\n摘要中文。",
    )

    expect(rows).toEqual([
      { index: 0, id: "B001", sourceMarkdown: "Alpha paragraph.", translatedMarkdown: "第一段中文。" },
      { index: 1, id: "B002", sourceMarkdown: "Short.", translatedMarkdown: "" },
      { index: 2, id: "B003", sourceMarkdown: "Summary paragraph.", translatedMarkdown: "摘要中文。" },
    ])
  })

  it("appends extra numbered translated blocks instead of dropping them", () => {
    const rows = alignedTranslationRows("Only source.", "[[B001]]\n正文。\n\n[[B004]]\n补充。")

    expect(rows).toEqual([
      { index: 0, id: "B001", sourceMarkdown: "Only source.", translatedMarkdown: "正文。" },
      { index: 1, id: "B004", sourceMarkdown: "", translatedMarkdown: "补充。" },
    ])
  })

  it("falls back to paragraph order when no block ids are present", () => {
    const rows = alignedTranslationRows("A.\n\nB.", "甲。\n\n乙。\n\n丙。")

    expect(rows).toEqual([
      { index: 0, id: "B001", sourceMarkdown: "A.", translatedMarkdown: "甲。" },
      { index: 1, id: "B002", sourceMarkdown: "B.", translatedMarkdown: "乙。" },
      { index: 2, id: "B003", sourceMarkdown: "", translatedMarkdown: "丙。" },
    ])
  })

  it("strips translation boilerplate, source echoes, fences, and trailing notes", () => {
    const source =
      "This source paragraph is intentionally long enough to be detected as an echo.\n\nSecond source."
    const cleaned = sanitizeDisplayedTranslationMarkdown(
      "```markdown\n以下是中文翻译\n\nThis source paragraph is intentionally long enough to be detected as an echo.\n\n第一段译文。\n\n翻译说明：省略。\n```",
      source,
    )

    expect(cleaned).toBe("第一段译文。")
  })

  it("sanitizes numbered translation blocks before alignment", () => {
    const cleaned = sanitizeDisplayedTranslationMarkdown(
      "[[B001]]\n中文译文\n\n[[B002]]\n第二段译文。",
      "A.\n\nB.",
    )

    expect(cleaned).toBe("[[B001]]\n\n[[B002]]\n第二段译文。")
  })

  it("splits markdown blocks on blank lines only", () => {
    expect(splitMarkdownBlocks("A\ncontinues\n\nB\r\n\r\nC")).toEqual([
      "A\ncontinues",
      "B",
      "C",
    ])
  })

  it("maps translated selections back to the source block", () => {
    const row = sourceBlockForTranslatedSelection(
      "Alpha paragraph.\n\nBeta paragraph.",
      "[[B001]]\n阿尔法段落。\n\n[[B002]]\n贝塔段落。",
      "贝塔",
    )

    expect(row).toMatchObject({
      id: "B002",
      sourceMarkdown: "Beta paragraph.",
      translatedMarkdown: "贝塔段落。",
    })
  })
})
