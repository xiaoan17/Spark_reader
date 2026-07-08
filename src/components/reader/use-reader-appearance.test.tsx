import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useReaderAppearance, type ReaderAppearance } from "./use-reader-appearance"
import { READER_DISPLAY_THEME_STORAGE_KEY } from "./reader-display-theme"
import { READER_COLOR_MODE_STORAGE_KEY } from "./reader-color-mode"
import { READER_TYPOGRAPHY_STORAGE_KEY } from "./reader-typography"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

type MediaController = { set(prefersDark: boolean): void }

function installMatchMedia(initialDark: boolean): MediaController {
  let matches = initialDark
  const listeners = new Set<() => void>()
  const mql = {
    get matches() {
      return matches
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) => listeners.delete(cb),
    addListener: (cb: () => void) => listeners.add(cb),
    removeListener: (cb: () => void) => listeners.delete(cb),
    dispatchEvent: () => true,
  }
  window.matchMedia = vi.fn(() => mql) as unknown as typeof window.matchMedia
  return {
    set(next: boolean) {
      matches = next
      listeners.forEach((cb) => cb())
    },
  }
}

let latest: ReaderAppearance | null = null

function Harness() {
  latest = useReaderAppearance()
  return null
}

let activeRoot: Root | null = null

async function mount() {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  activeRoot = root
  await act(async () => {
    root.render(<Harness />)
    await Promise.resolve()
  })
}

function appearance(): ReaderAppearance {
  if (!latest) {
    throw new Error("harness not mounted")
  }
  return latest
}

async function run(action: () => void) {
  await act(async () => {
    action()
    await Promise.resolve()
  })
}

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.classList.remove("dark")
  latest = null
})

afterEach(() => {
  if (activeRoot) {
    act(() => activeRoot?.unmount())
    activeRoot = null
  }
  document.body.replaceChildren()
})

describe("useReaderAppearance typography", () => {
  it("applies user overrides on top of the theme and keeps them when the theme changes", async () => {
    installMatchMedia(false)
    await mount()

    await run(() => appearance().setTypographyOverride("fontScale", "lg"))
    await run(() => appearance().setTypographyOverride("pageWidth", "narrow"))

    // spark-paper base 16px * 1.125 = 18px, narrow width 640px.
    expect(appearance().readerDisplayStyle["--reader-font-size"]).toBe("18px")
    expect(appearance().readerDisplayStyle["--reader-page-width"]).toBe("640px")
    expect(appearance().hasTypographyOverride).toBe(true)

    // Switching theme must not reset the override; it re-scales off the new base (pixyll 18px).
    await run(() => appearance().setDisplayThemeId("typora-pixyll"))
    expect(appearance().displayThemeId).toBe("typora-pixyll")
    expect(appearance().readerDisplayStyle["--reader-font-size"]).toBe("20.25px")
    expect(appearance().readerDisplayStyle["--reader-page-width"]).toBe("640px")
  })

  it("restores theme defaults and clears persistence on reset", async () => {
    installMatchMedia(false)
    await mount()

    await run(() => appearance().setTypographyOverride("lineHeight", "tight"))
    expect(appearance().readerDisplayStyle["--reader-line-height"]).toBe("1.5")

    await run(() => appearance().resetTypography())
    expect(appearance().hasTypographyOverride).toBe(false)
    // Falls back to the theme's own line-height (spark-paper = "2").
    expect(appearance().readerDisplayStyle["--reader-line-height"]).toBe("2")
    expect(window.localStorage.getItem(READER_TYPOGRAPHY_STORAGE_KEY)).toContain("null")
  })

  it("persists overrides and rehydrates them on remount", async () => {
    installMatchMedia(false)
    await mount()
    await run(() => appearance().setTypographyOverride("fontScale", "xl"))
    expect(window.localStorage.getItem(READER_TYPOGRAPHY_STORAGE_KEY)).toContain("xl")

    await act(() => activeRoot?.unmount())
    activeRoot = null
    latest = null
    await mount()
    expect(appearance().typography.fontScale).toBe("xl")
  })
})

describe("useReaderAppearance color mode", () => {
  it("toggles the root .dark class for the explicit dark mode and persists it", async () => {
    installMatchMedia(false)
    await mount()
    expect(document.documentElement.classList.contains("dark")).toBe(false)

    await run(() => appearance().setColorMode("dark"))
    expect(appearance().resolvedColorMode).toBe("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(window.localStorage.getItem(READER_COLOR_MODE_STORAGE_KEY)).toBe("dark")

    await run(() => appearance().setColorMode("light"))
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("follows the live system preference in system mode", async () => {
    const media = installMatchMedia(false)
    await mount()
    // Default mode is system; system currently light.
    expect(appearance().colorMode).toBe("system")
    expect(appearance().resolvedColorMode).toBe("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)

    await run(() => media.set(true))
    expect(appearance().resolvedColorMode).toBe("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)

    await run(() => media.set(false))
    expect(appearance().resolvedColorMode).toBe("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("uses the dark theme color variant when resolved dark, without changing typography", async () => {
    installMatchMedia(false)
    await mount()
    await run(() => appearance().setDisplayThemeId("typora-github"))

    const lightSurface = appearance().readerDisplayStyle["--reader-surface-bg"]
    const lightFont = appearance().readerDisplayStyle["--reader-font-size"]
    expect(lightSurface).toBe("#ffffff")

    await run(() => appearance().setColorMode("dark"))
    expect(appearance().readerDisplayStyle["--reader-surface-bg"]).toBe("#0d1117")
    expect(appearance().readerDisplayStyle["--reader-font-size"]).toBe(lightFont)
  })

  it("persists the display theme choice", async () => {
    installMatchMedia(false)
    await mount()
    await run(() => appearance().setDisplayThemeId("typora-whitey"))
    expect(window.localStorage.getItem(READER_DISPLAY_THEME_STORAGE_KEY)).toBe("typora-whitey")
  })
})
