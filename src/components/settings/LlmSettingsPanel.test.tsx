import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getEmbeddingSettings,
  getLlmSettings,
  getMineruSettings,
  isTauriRuntime,
  productSelfCheck,
  saveEmbeddingSettings,
  saveLlmSettings,
  saveMineruSettings,
} from "@/core/library-api"
import { LlmSettingsPanel } from "./LlmSettingsPanel"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/core/library-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/library-api")>()
  return {
    ...actual,
    getEmbeddingSettings: vi.fn(async () => ({
      provider: "siliconflow",
      baseUrl: "https://api.siliconflow.cn/v1/embeddings",
      model: "Qwen/Qwen3-Embedding-4B",
      expectedDimension: 2560,
      apiKeyConfigured: true,
      enabled: true,
    })),
    getLlmSettings: vi.fn(async () => ({
      provider: "deep_seek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKeyConfigured: true,
    })),
    getMineruSettings: vi.fn(async () => ({
      baseUrl: "https://mineru.net",
      apiTokenConfigured: false,
    })),
    isTauriRuntime: vi.fn(() => false),
    productSelfCheck: vi.fn(),
    saveEmbeddingSettings: vi.fn(async () => ({
      provider: "siliconflow",
      baseUrl: "https://api.siliconflow.cn/v1/embeddings",
      model: "Qwen/Qwen3-Embedding-4B",
      expectedDimension: 2560,
      apiKeyConfigured: true,
      enabled: true,
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
  }
})

beforeEach(() => {
  document.body.replaceChildren()
  vi.mocked(isTauriRuntime).mockReturnValue(false)
  vi.mocked(productSelfCheck).mockReset()
  vi.mocked(saveEmbeddingSettings).mockClear()
  vi.mocked(saveLlmSettings).mockClear()
  vi.mocked(saveMineruSettings).mockClear()
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

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("LlmSettingsPanel defaults", () => {
  it("prefills DeepSeek and external SiliconFlow embedding settings without exposing keys", () => {
    const html = renderToStaticMarkup(
      <LlmSettingsPanel open onClose={() => undefined} />,
    )

    expect(html).toContain("deepseek-v4-flash")
    expect(html).toContain("siliconflow")
    expect(html).toContain("https://api.siliconflow.cn/v1/embeddings")
    expect(html).toContain("Qwen/Qwen3-Embedding-4B")
    expect(html).toContain("https://mineru.net")
    expect(html).toContain("MinerU 云端解析")
    expect(html).toContain('value="2560"')
    expect(html).not.toContain("sk-")
  })

  it("saves MinerU token from the settings panel without rendering the secret", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true)

    const { container, unmount } = await renderClient(
      <LlmSettingsPanel open onClose={() => undefined} />,
    )

    const tokenInput = [...container.querySelectorAll("input")].find((input) =>
      input.placeholder.includes("MinerU token"),
    )
    if (!(tokenInput instanceof HTMLInputElement)) {
      throw new Error("missing MinerU token input")
    }
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(tokenInput),
        "value",
      )
      descriptor?.set?.call(tokenInput, "mineru-secret-token")
      tokenInput.dispatchEvent(new Event("input", { bubbles: true }))
      tokenInput.dispatchEvent(new Event("change", { bubbles: true }))
      await Promise.resolve()
    })
    await click(buttonByText(container, "保存 MinerU"))

    await vi.waitFor(() => {
      expect(saveMineruSettings).toHaveBeenCalledWith({
        baseUrl: "https://mineru.net",
        apiToken: "mineru-secret-token",
      })
      expect(textContent(container)).toContain("MinerU 设置已保存")
    })
    expect(textContent(container)).not.toContain("mineru-secret-token")
    unmount()
  })

  it("keeps per-section save buttons and can save all settings from the footer", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true)

    const { container, unmount } = await renderClient(
      <LlmSettingsPanel open onClose={() => undefined} />,
    )

    expect(buttonByText(container, "保存 LLM")).toBeInstanceOf(HTMLButtonElement)
    expect(buttonByText(container, "保存 MinerU")).toBeInstanceOf(HTMLButtonElement)
    expect(buttonByText(container, "保存 Embedding")).toBeInstanceOf(HTMLButtonElement)
    await click(buttonByText(container, "保存全部"))

    await vi.waitFor(() => {
      expect(saveLlmSettings).toHaveBeenCalledWith({
        provider: "deep_seek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        apiKey: undefined,
      })
      expect(saveMineruSettings).toHaveBeenCalledWith({
        baseUrl: "https://mineru.net",
        apiToken: undefined,
      })
      expect(saveEmbeddingSettings).toHaveBeenCalledWith({
        provider: "siliconflow",
        baseUrl: "https://api.siliconflow.cn/v1/embeddings",
        model: "Qwen/Qwen3-Embedding-4B",
        expectedDimension: 2560,
        enabled: true,
        apiKey: undefined,
      })
    })
    unmount()
  })

  it("runs product self-check from the settings panel and renders the result", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    vi.mocked(productSelfCheck).mockResolvedValue({
      ok: true,
      runId: "self-check-1",
      checkedAt: "1770000000",
      steps: [
        {
          id: "convert",
          label: "PDF 转 Markdown/chunks",
          ok: true,
          detail: "1 页、1 个 chunk、42 字",
        },
        {
          id: "interpret",
          label: "深度解读与引用",
          ok: true,
          detail: "1 条证据，回答包含 [p1-c1]",
        },
      ],
      summary: {
        bookId: "book-self-check",
        pageCount: 1,
        chunkCount: 1,
        textCharCount: 42,
        markdownCharCount: 58,
        searchHitCount: 1,
        evidenceCount: 2,
        citationCount: 2,
        highlightCount: 1,
        interpretationCount: 2,
        tempDir: "/tmp/self-check",
      },
    })

    const { container, unmount } = await renderClient(
      <LlmSettingsPanel open onClose={() => undefined} />,
    )

    expect(textContent(container)).toContain("产品自检")
    await click(buttonByText(container, "运行自检"))

    await vi.waitFor(() => {
      expect(productSelfCheck).toHaveBeenCalledTimes(1)
      expect(textContent(container)).toContain("产品自检通过：2 个核心步骤已跑通")
    })
    expect(textContent(container)).toContain("PDF 转 Markdown")
    expect(textContent(container)).toContain("深度解读与引用")
    expect(textContent(container)).toContain("搜索命中 1")
    expect(textContent(container)).toContain("引用 2")
    expect(textContent(container)).not.toContain("chunks")
    expect(textContent(container)).not.toContain("[p1-c1]")
    unmount()
  })
})
