import { describe, expect, it, vi } from "vitest"
import { localImagePathFromSrc, markdownImageSrc } from "./markdown-assets"

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}))

describe("markdown image asset URLs", () => {
  it("extracts local paths from file URLs", () => {
    expect(localImagePathFromSrc("file:///tmp/book/images/chart%20one.png")).toBe(
      "/tmp/book/images/chart one.png",
    )
  })

  it("leaves remote and data URLs untouched", () => {
    expect(localImagePathFromSrc("https://example.com/chart.png")).toBe("")
    expect(localImagePathFromSrc("data:image/png;base64,abc")).toBe("")
  })

  it("converts local desktop image paths into Tauri asset URLs", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    })

    expect(markdownImageSrc("file:///tmp/book/images/chart%20one.png")).toContain(
      "asset://localhost/",
    )

    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })
})
