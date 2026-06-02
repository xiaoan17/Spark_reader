import { describe, expect, it } from "vitest"
import { friendlyImportErrorMessage } from "./import-errors"

describe("reader import errors", () => {
  it("renders structured command suggestions as actionable user copy", () => {
    expect(
      friendlyImportErrorMessage({
        code: "mineru_token",
        message: "MinerU API Token 未配置。",
        suggestion: "请在设置里填入有效的 MinerU API Token 后重试。",
      }),
    ).toBe("MinerU API Token 未配置或无效。建议：请在设置里填入有效的 MinerU API Token 后重试。")
  })

  it("maps legacy timeout and auth errors to product language", () => {
    expect(friendlyImportErrorMessage("request timed out")).toContain("云端解析等待超时")
    expect(friendlyImportErrorMessage("401 unauthorized")).toContain("云端解析认证失败")
  })
})
