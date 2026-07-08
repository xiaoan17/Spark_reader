import { describe, expect, it } from "vitest"
import {
  CommandError,
  exportBookKnowledgeToObsidian,
  exportSnippetToObsidian,
  getObsidianSettings,
  normalizeCommandError,
  saveObsidianSettings,
} from "./library-api"

describe("library api command errors", () => {
  it("normalizes structured command errors without losing suggestions", () => {
    const error = normalizeCommandError({
      code: "mineru_token",
      message: "MinerU API Token 未配置。",
      suggestion: "请在设置里填入有效的 MinerU API Token 后重试。",
    })

    expect(error).toBeInstanceOf(CommandError)
    expect(error.code).toBe("mineru_token")
    expect(error.suggestion).toBe("请在设置里填入有效的 MinerU API Token 后重试。")
    expect(error.message).toContain("MinerU API Token 未配置。")
    expect(error.message).toContain("请在设置里填入有效的 MinerU API Token 后重试。")
  })

  it("keeps legacy string command errors readable", () => {
    const error = normalizeCommandError("database is locked")

    expect(error.code).toBe("unknown")
    expect(error.message).toBe("database is locked")
  })

  it("uses product language for unknown command failures", () => {
    const error = normalizeCommandError(null)

    expect(error.code).toBe("unknown")
    expect(error.message).toContain("桌面版操作失败")
    expect(error.message).toContain("开发诊断")
    expect(error.message).not.toContain("后端")
  })
})

describe("obsidian export api in browser mode", () => {
  // In the test environment `window.__TAURI_INTERNALS__` is absent, so the
  // desktop-only commands take the browser fallback path.
  it("reports an unconfigured vault without touching the desktop bridge", async () => {
    await expect(getObsidianSettings()).resolves.toEqual({
      vaultPath: "",
      subdir: "",
      configured: false,
    })
  })

  it("fails saving settings with a readable desktop-only message", async () => {
    await expect(saveObsidianSettings({ vaultPath: "/vault" })).rejects.toMatchObject({
      message: "Obsidian 导出需要桌面版。",
    })
    await expect(saveObsidianSettings({ vaultPath: "/vault" })).rejects.toBeInstanceOf(CommandError)
  })

  it("fails snippet export gracefully outside the desktop app", async () => {
    await expect(
      exportSnippetToObsidian("book-1", {
        kind: "spark",
        content: "解读正文",
        chunkIds: ["b1-p1-c1"],
        timestamp: "2026-07-07 21:30",
      }),
    ).rejects.toBeInstanceOf(CommandError)
  })

  it("fails knowledge export gracefully outside the desktop app", async () => {
    await expect(exportBookKnowledgeToObsidian("book-1")).rejects.toBeInstanceOf(CommandError)
  })
})
