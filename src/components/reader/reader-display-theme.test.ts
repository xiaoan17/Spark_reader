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

  it("declares a dark color variant for every theme", () => {
    for (const theme of readerDisplayThemeOptions) {
      const colorKeys = Object.keys(theme.darkVars)
      expect(colorKeys).toContain("shellBg")
      expect(colorKeys).toContain("panelActiveText")
      expect(colorKeys).toContain("floatingBorder")
    }
  })

  it("swaps only the color tokens in dark mode, keeping typography from the light variant", () => {
    const light = readerDisplayThemeStyle("typora-github", "light")
    const dark = readerDisplayThemeStyle("typora-github", "dark")

    // Colors flip to the dark variant.
    expect(light["--reader-surface-bg"]).toBe("#ffffff")
    expect(dark["--reader-surface-bg"]).toBe("#0d1117")
    expect(dark["--reader-text"]).toBe("#c9d1d9")
    expect(dark["--reader-chrome-bg"]).toBe("#161b22")

    // Typography is unchanged across the two modes.
    expect(dark["--reader-font-size"]).toBe(light["--reader-font-size"])
    expect(dark["--reader-page-width"]).toBe(light["--reader-page-width"])
    expect(dark["--reader-body-font"]).toBe(light["--reader-body-font"])
  })
})
