import { describe, expect, it } from "vitest"
import { readerDisplayThemeById } from "./reader-display-theme"
import {
  defaultReaderTypographyOverrides,
  hasReaderTypographyOverride,
  normalizeReaderTypographyOverrides,
  readerTypographyStyle,
} from "./reader-typography"

describe("reader typography overrides", () => {
  it("leaves every typographic variable to the theme when nothing is overridden", () => {
    const theme = readerDisplayThemeById("spark-paper")
    const style = readerTypographyStyle(defaultReaderTypographyOverrides, theme)
    expect(style["--reader-font-size"]).toBeUndefined()
    expect(style["--reader-line-height"]).toBeUndefined()
    expect(style["--reader-page-width"]).toBeUndefined()
  })

  it("scales font size off the current theme base so switching theme keeps the choice", () => {
    const spark = readerDisplayThemeById("spark-paper") // base 16px
    const pixyll = readerDisplayThemeById("typora-pixyll") // base 18px
    const overrides = { fontScale: "lg" as const, lineHeight: null, pageWidth: null }

    // lg = 1.125 multiplier applied to each theme's own base.
    expect(readerTypographyStyle(overrides, spark)["--reader-font-size"]).toBe("18px")
    expect(readerTypographyStyle(overrides, pixyll)["--reader-font-size"]).toBe("20.25px")
  })

  it("applies absolute line-height and page-width overrides", () => {
    const theme = readerDisplayThemeById("spark-paper")
    const style = readerTypographyStyle(
      { fontScale: null, lineHeight: "relaxed", pageWidth: "narrow" },
      theme,
    )
    expect(style["--reader-line-height"]).toBe("2.1")
    expect(style["--reader-page-width"]).toBe("640px")
    // Untouched axes stay with the theme.
    expect(style["--reader-font-size"]).toBeUndefined()
  })

  it("normalizes unknown persisted values back to null", () => {
    expect(
      normalizeReaderTypographyOverrides({ fontScale: "huge", lineHeight: "snug", pageWidth: 3 }),
    ).toEqual({ fontScale: null, lineHeight: "snug", pageWidth: null })
    expect(normalizeReaderTypographyOverrides(null)).toEqual(defaultReaderTypographyOverrides)
    expect(normalizeReaderTypographyOverrides("nope")).toEqual(defaultReaderTypographyOverrides)
  })

  it("reports whether any axis is overridden", () => {
    expect(hasReaderTypographyOverride(defaultReaderTypographyOverrides)).toBe(false)
    expect(
      hasReaderTypographyOverride({ fontScale: null, lineHeight: null, pageWidth: "wide" }),
    ).toBe(true)
  })
})
