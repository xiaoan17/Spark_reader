import { describe, expect, it } from "vitest"
import {
  normalizeReaderDisplayThemeId,
  readerDisplayThemeById,
  readerDisplayThemeOptions,
  readerDisplayThemeStyle,
} from "./reader-display-theme"

describe("reader display themes", () => {
  it("offers the current Spark style plus Typora-inspired options", () => {
    expect(readerDisplayThemeOptions.map((theme) => theme.id)).toEqual([
      "spark-paper",
      "typora-github",
      "typora-newsprint",
      "typora-night",
      "typora-pixyll",
      "typora-gothic",
      "typora-whitey",
    ])
    expect(readerDisplayThemeOptions.map((theme) => theme.sourceName)).toContain("newsprint.css")
    expect(readerDisplayThemeOptions.map((theme) => theme.sourceName)).toContain("night.css")
  })

  it("normalizes unknown persisted ids to the default reader theme", () => {
    expect(normalizeReaderDisplayThemeId("typora-pixyll")).toBe("typora-pixyll")
    expect(normalizeReaderDisplayThemeId("missing-theme")).toBe("spark-paper")
    expect(readerDisplayThemeById("missing-theme").id).toBe("spark-paper")
  })

  it("maps theme tokens to scoped CSS variables", () => {
    const nightStyle = readerDisplayThemeStyle("typora-night")

    expect(nightStyle["--reader-shell-bg"]).toBe("#363b40")
    expect(nightStyle["--reader-text"]).toBe("#b8bfc6")
    expect(nightStyle["--reader-page-width"]).toBe("914px")
    expect(nightStyle["--reader-workspace-bg"]).toBe("#2f3439")
    expect(nightStyle["--reader-panel-bg"]).toBe("#2e3033")
    expect(nightStyle["--reader-floating-bg"]).toBe("#33383e")
  })
})
