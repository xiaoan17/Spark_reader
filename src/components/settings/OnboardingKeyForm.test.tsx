import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getLlmSettings,
  getMineruSettings,
  isTauriRuntime,
  saveLlmSettings,
  saveMineruSettings,
  testLlmConnectionWithSettings,
  testMineruConnectionWithSettings,
} from "@/core/library-api"
import { OnboardingKeyForm } from "./OnboardingKeyForm"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/core/library-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/library-api")>()
  return {
    ...actual,
    isTauriRuntime: vi.fn(() => true),
    getLlmSettings: vi.fn(async () => ({
      provider: "deep_seek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKeyConfigured: false,
    })),
    getMineruSettings: vi.fn(async () => ({
      baseUrl: "https://mineru.net",
      apiTokenConfigured: false,
    })),
    saveLlmSettings: vi.fn(async () => ({
      provider: "deep_seek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKeyConfigured: true,
    })),
    saveMineruSettings: vi.fn(async () => ({
      baseUrl: "https://mineru.net",
      apiTokenConfigured: true,
    })),
    testLlmConnectionWithSettings: vi.fn(async () => ({
      provider: "deep_seek",
      model: "deepseek-v4-flash",
      ok: true,
    })),
    testMineruConnectionWithSettings: vi.fn(async () => ({
      baseUrl: "https://mineru.net",
      ok: true,
      checked: "extract-results/batch",
    })),
  }
})

beforeEach(() => {
  document.body.replaceChildren()
  vi.mocked(isTauriRuntime).mockReturnValue(true)
  vi.mocked(getLlmSettings).mockClear()
  vi.mocked(getMineruSettings).mockClear()
  vi.mocked(saveLlmSettings).mockClear()
  vi.mocked(saveMineruSettings).mockClear()
  vi.mocked(testLlmConnectionWithSettings).mockClear()
  vi.mocked(testMineruConnectionWithSettings).mockClear()
})

async function renderClient(element: React.ReactElement) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(element)
    await Promise.resolve()
    await Promise.resolve()
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

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

function inputByLabel(container: ParentNode, labelText: string) {
  const label = [...container.querySelectorAll("label")].find((element) =>
    textContent(element).startsWith(labelText),
  )
  const input = label?.querySelector("input")
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`missing input label: ${labelText}`)
  }
  return input
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function setInputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")
    descriptor?.set?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await Promise.resolve()
  })
}

describe("OnboardingKeyForm", () => {
  it("saves then tests both keys and reports connectivity success", async () => {
    const onLlmSettingsSaved = vi.fn()
    const { container, unmount } = await renderClient(
      <OnboardingKeyForm desktopAvailable onLlmSettingsSaved={onLlmSettingsSaved} />,
    )

    await setInputValue(inputByLabel(container, "DeepSeek API Key"), "deepseek-secret")
    await setInputValue(inputByLabel(container, "MinerU API Token"), "mineru-secret")
    await click(buttonByText(container, "保存并测试"))

    await vi.waitFor(() => {
      expect(saveLlmSettings).toHaveBeenCalledWith({
        provider: "deep_seek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        apiKey: "deepseek-secret",
      })
      expect(testLlmConnectionWithSettings).toHaveBeenCalledWith({
        provider: "deep_seek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        apiKey: "deepseek-secret",
      })
      expect(saveMineruSettings).toHaveBeenCalledWith({
        baseUrl: "https://mineru.net",
        apiToken: "mineru-secret",
      })
      expect(testMineruConnectionWithSettings).toHaveBeenCalled()
      expect(textContent(container)).toContain("DeepSeek deepseek-v4-flash 连通正常")
      expect(textContent(container)).toContain("MinerU 连通正常")
    })
    expect(onLlmSettingsSaved).toHaveBeenCalledTimes(1)
    expect(textContent(container)).not.toContain("deepseek-secret")
    expect(textContent(container)).not.toContain("mineru-secret")
    unmount()
  })

  it("shows an error and offers 重试 when the LLM connectivity test fails", async () => {
    vi.mocked(testLlmConnectionWithSettings).mockResolvedValueOnce({
      provider: "deep_seek",
      model: "deepseek-v4-flash",
      ok: false,
    })

    const { container, unmount } = await renderClient(<OnboardingKeyForm desktopAvailable />)

    await setInputValue(inputByLabel(container, "DeepSeek API Key"), "bad-key")
    await click(buttonByText(container, "保存并测试"))

    await vi.waitFor(() => {
      expect(textContent(container)).toContain("连通失败，请检查 key 后重试")
      expect(buttonByText(container, "重试")).toBeInstanceOf(HTMLButtonElement)
    })
    unmount()
  })

  it("blocks saving and shows degraded copy in browser mode", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(false)

    const { container, unmount } = await renderClient(
      <OnboardingKeyForm desktopAvailable={false} />,
    )

    expect(textContent(container)).toContain("保存密钥和连通测试请使用桌面版")
    expect(buttonByText(container, "保存并测试").disabled).toBe(true)
    expect(getLlmSettings).not.toHaveBeenCalled()
    expect(saveLlmSettings).not.toHaveBeenCalled()
    unmount()
  })
})
