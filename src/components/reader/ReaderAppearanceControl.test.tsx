import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ReaderAppearanceControl,
  type ReaderAppearanceControlProps,
} from "./ReaderAppearanceControl"
import { readerDisplayThemeOptions } from "./reader-display-theme"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

function baseProps(overrides: Partial<ReaderAppearanceControlProps> = {}): ReaderAppearanceControlProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    displayThemeId: "spark-paper",
    displayThemeItems: readerDisplayThemeOptions,
    colorMode: "system",
    typography: { fontScale: null, lineHeight: null, pageWidth: null },
    hasTypographyOverride: false,
    onDisplayThemeChange: vi.fn(),
    onColorModeChange: vi.fn(),
    onTypographyChange: vi.fn(),
    onResetTypography: vi.fn(),
    ...overrides,
  }
}

let activeRoot: Root | null = null
let activeContainer: HTMLDivElement | null = null

async function render(props: ReaderAppearanceControlProps) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  activeRoot = root
  activeContainer = container
  await act(async () => {
    root.render(<ReaderAppearanceControl {...props} />)
    await Promise.resolve()
  })
  return container
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
  })
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button")).find(
    (node) => node.textContent?.trim() === label,
  )
  if (!match) {
    throw new Error(`button not found: ${label}`)
  }
  return match as HTMLButtonElement
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  if (activeRoot) {
    act(() => activeRoot?.unmount())
    activeRoot = null
  }
  activeContainer?.remove()
  activeContainer = null
})

describe("ReaderAppearanceControl", () => {
  it("opens the appearance popover from the Aa trigger", async () => {
    const onOpenChange = vi.fn()
    const container = await render(baseProps({ open: false, onOpenChange }))
    expect(container.querySelector("[data-testid='reader-display-theme-menu']")).toBeNull()

    await click(container.querySelector("[data-testid='reader-display-theme-button']")!)
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it("selects a reader theme without closing (single merged entry)", async () => {
    const onDisplayThemeChange = vi.fn()
    const container = await render(baseProps({ onDisplayThemeChange }))
    // Pick the Night theme option by its label text.
    const nightOption = Array.from(container.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("Night"),
    )!
    await click(nightOption)
    expect(onDisplayThemeChange).toHaveBeenCalledWith("typora-night")
  })

  it("routes each typography axis to onTypographyChange", async () => {
    const onTypographyChange = vi.fn()
    const container = await render(baseProps({ onTypographyChange }))

    await click(button(container, "较大"))
    expect(onTypographyChange).toHaveBeenCalledWith("fontScale", "lg")

    await click(button(container, "宽松"))
    expect(onTypographyChange).toHaveBeenCalledWith("lineHeight", "relaxed")

    await click(button(container, "窄"))
    expect(onTypographyChange).toHaveBeenCalledWith("pageWidth", "narrow")
  })

  it("clears an axis when its active step is clicked again", async () => {
    const onTypographyChange = vi.fn()
    const container = await render(
      baseProps({
        typography: { fontScale: "lg", lineHeight: null, pageWidth: null },
        hasTypographyOverride: true,
        onTypographyChange,
      }),
    )
    await click(button(container, "较大"))
    expect(onTypographyChange).toHaveBeenCalledWith("fontScale", null)
  })

  it("shows the reset control only when an override exists", async () => {
    const withoutOverride = await render(baseProps({ hasTypographyOverride: false }))
    expect(withoutOverride.querySelector("[data-testid='reader-typography-reset']")).toBeNull()
    await act(() => activeRoot?.unmount())
    activeRoot = null
    activeContainer?.remove()

    const onResetTypography = vi.fn()
    const withOverride = await render(
      baseProps({ hasTypographyOverride: true, onResetTypography }),
    )
    await click(withOverride.querySelector("[data-testid='reader-typography-reset']")!)
    expect(onResetTypography).toHaveBeenCalledTimes(1)
  })

  it("switches color mode through the tri-state control", async () => {
    const onColorModeChange = vi.fn()
    const container = await render(baseProps({ onColorModeChange }))
    await click(button(container, "深色"))
    expect(onColorModeChange).toHaveBeenCalledWith("dark")
    await click(button(container, "跟随系统"))
    expect(onColorModeChange).toHaveBeenCalledWith("system")
  })
})
