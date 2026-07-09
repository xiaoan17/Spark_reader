import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { OnboardingFlow } from "./OnboardingFlow"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  document.body.replaceChildren()
})

function textContent(element: Element | null | undefined) {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? ""
}

function buttonByText(container: ParentNode, text: string) {
  const button = [...container.querySelectorAll("button")].find((element) =>
    textContent(element).includes(text),
  )
  if (!button) {
    throw new Error(`missing button: ${text}`)
  }
  return button
}

async function renderTree(root: Root, element: React.ReactElement) {
  await act(async () => {
    root.render(element)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

type Overrides = Partial<React.ComponentProps<typeof OnboardingFlow>>

function baseProps(overrides: Overrides = {}): React.ComponentProps<typeof OnboardingFlow> {
  return {
    open: true,
    hasSampleBook: true,
    desktopAvailable: false,
    onClose: vi.fn(),
    onOpenSample: vi.fn(),
    onImport: vi.fn(),
    onLlmSettingsSaved: vi.fn(),
    ...overrides,
  }
}

describe("OnboardingFlow wizard", () => {
  it("advances through the three steps and finishes with onClose", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const onClose = vi.fn()
    await renderTree(root, <OnboardingFlow {...baseProps({ onClose })} />)

    expect(textContent(container)).toContain("第 1 步 · 先体验示例书")

    await click(buttonByText(container, "下一步"))
    expect(textContent(container)).toContain("第 2 步 · 配置模型 key")

    await click(buttonByText(container, "下一步"))
    expect(textContent(container)).toContain("第 3 步 · 开始读自己的书")

    await click(buttonByText(container, "完成"))
    expect(onClose).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    container.remove()
  })

  it("loads the sample book and moves on to the configure step", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const onOpenSample = vi.fn()
    await renderTree(root, <OnboardingFlow {...baseProps({ onOpenSample })} />)

    await click(buttonByText(container, "打开示例书"))
    expect(onOpenSample).toHaveBeenCalledTimes(1)
    expect(textContent(container)).toContain("第 2 步 · 配置模型 key")

    act(() => root.unmount())
    container.remove()
  })

  it("skips from any step via 跳过引导", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const onClose = vi.fn()
    await renderTree(root, <OnboardingFlow {...baseProps({ onClose })} />)

    await click(buttonByText(container, "下一步"))
    await click(buttonByText(container, "跳过引导"))
    expect(onClose).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    container.remove()
  })

  it("resets to the first step when reopened", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    await renderTree(root, <OnboardingFlow {...baseProps()} />)

    await click(buttonByText(container, "下一步"))
    await click(buttonByText(container, "下一步"))
    expect(textContent(container)).toContain("第 3 步")

    await renderTree(root, <OnboardingFlow {...baseProps({ open: false })} />)
    await renderTree(root, <OnboardingFlow {...baseProps({ open: true })} />)
    expect(textContent(container)).toContain("第 1 步 · 先体验示例书")

    act(() => root.unmount())
    container.remove()
  })

  it("disables the sample button when no sample book is available", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    await renderTree(root, <OnboardingFlow {...baseProps({ hasSampleBook: false })} />)

    expect(buttonByText(container, "打开示例书").disabled).toBe(true)

    act(() => root.unmount())
    container.remove()
  })
})
