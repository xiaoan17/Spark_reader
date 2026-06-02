import { describe, expect, it } from "vitest"
import { CommandError, normalizeCommandError } from "./library-api"

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
