import { describe, expect, it } from "vitest"

import {
  buildExportPreview,
  formatExportDateStamp,
  isExportEmpty,
  knowledgeExportFilename,
  sanitizeExportName,
} from "./knowledge-export"

describe("sanitizeExportName", () => {
  it("replaces filesystem-unsafe characters and whitespace", () => {
    expect(sanitizeExportName('a/b:c*d?"e<f>g|h')).toBe("a-b-c-d-e-f-g-h")
    expect(sanitizeExportName("  hello   world  ")).toBe("hello-world")
  })

  it("falls back when the result would be empty", () => {
    expect(sanitizeExportName("   ")).toBe("reading-knowledge")
    expect(sanitizeExportName("")).toBe("reading-knowledge")
  })

  it("caps length at 80 characters", () => {
    expect(sanitizeExportName("x".repeat(200))).toHaveLength(80)
  })
})

describe("formatExportDateStamp", () => {
  it("formats a date as YYYYMMDD with zero padding", () => {
    expect(formatExportDateStamp(new Date(2026, 5, 7))).toBe("20260607")
    expect(formatExportDateStamp(new Date(2026, 11, 31))).toBe("20261231")
  })
})

describe("knowledgeExportFilename", () => {
  const date = new Date(2026, 5, 7)

  it("builds a stable Markdown filename with the 知识册 label", () => {
    expect(knowledgeExportFilename("财富公式", "md", date)).toBe("财富公式-知识册-20260607.md")
  })

  it("builds a stable JSON filename with the knowledge label", () => {
    expect(knowledgeExportFilename("财富公式", "json", date)).toBe("财富公式-knowledge-20260607.json")
  })

  it("sanitizes the title in the filename", () => {
    expect(knowledgeExportFilename("a/b c", "md", date)).toBe("a-b-c-知识册-20260607.md")
  })
})

describe("isExportEmpty", () => {
  it("treats null/undefined/blank as empty", () => {
    expect(isExportEmpty(null)).toBe(true)
    expect(isExportEmpty(undefined)).toBe(true)
    expect(isExportEmpty("")).toBe(true)
  })

  it("treats heading-only content as empty (single, no cards)", () => {
    expect(isExportEmpty("# 阅读知识册\n\n## 总览\n")).toBe(true)
  })

  it("detects the backend empty-book placeholder", () => {
    expect(isExportEmpty("# 阅读知识册\n\n这本书还没有知识卡片。")).toBe(true)
  })

  it("treats content with real body text as non-empty (multi)", () => {
    expect(isExportEmpty("# 阅读知识册\n\n## 总览\n\n| 类型 | 标题 |\n| 高亮 | 复利 |")).toBe(false)
  })
})

describe("buildExportPreview", () => {
  it("returns the original string when within the limit", () => {
    const short = "# small\n\nbody"
    expect(buildExportPreview(short)).toBe(short)
  })

  it("truncates long content and appends an ellipsis marker", () => {
    const long = "x".repeat(5000)
    const preview = buildExportPreview(long, 4000)
    expect(preview.length).toBeLessThan(long.length)
    expect(preview).toContain("预览已截断")
  })
})
