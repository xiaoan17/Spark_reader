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
  testLlmConnectionWithSettings,
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
      batchSize: 64,
      apiKeyConfigured: true,
      enabled: true,
    })),
    getLlmSettings: vi.fn(async () => ({
      provider: "deep_seek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKeyConfigured: true,
      providers: {
        deep_seek: {
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-flash",
          apiKeyConfigured: true,
        },
        open_ai: {
          baseUrl: "https://proxy.example.com/openai/v1",
          model: "custom-openai-model",
          apiKeyConfigured: true,
        },
        anthropic: {
          baseUrl: "https://proxy.example.com/anthropic",
          model: "custom-anthropic-model",
          apiKeyConfigured: false,
        },
      },
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
      batchSize: 64,
      apiKeyConfigured: true,
      enabled: true,
    })),
    saveLlmSettings: vi.fn(async () => ({
      provider: "deep_seek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKeyConfigured: true,
      providers: {
        deep_seek: {
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-flash",
          apiKeyConfigured: true,
        },
      },
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
  }
})

beforeEach(() => {
  document.body.replaceChildren()
  vi.mocked(isTauriRuntime).mockReturnValue(false)
  vi.mocked(getEmbeddingSettings).mockClear()
  vi.mocked(getLlmSettings).mockClear()
  vi.mocked(getMineruSettings).mockClear()
  vi.mocked(productSelfCheck).mockReset()
  vi.mocked(saveEmbeddingSettings).mockClear()
  vi.mocked(saveLlmSettings).mockClear()
  vi.mocked(saveMineruSettings).mockClear()
  vi.mocked(testLlmConnectionWithSettings).mockClear()
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

function inputByPlaceholder(container: ParentNode, placeholder: string) {
  const input = [...container.querySelectorAll("input")].find((element) =>
    element.placeholder.includes(placeholder),
  )
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`missing input placeholder: ${placeholder}`)
  }
  return input
}

function statusMessages(container: ParentNode) {
  return [...container.querySelectorAll(".rounded-md.bg-muted, .border-b.bg-muted\\/45")]
    .map((element) => textContent(element))
    .join(" ")
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
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value",
    )
    descriptor?.set?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await Promise.resolve()
  })
}

describe("LlmSettingsPanel defaults", () => {
  it("starts in recommended mode with provider presets and no advanced fields", () => {
    const html = renderToStaticMarkup(
      <LlmSettingsPanel open onClose={() => undefined} />,
    )

    expect(html).toContain("推荐模式")
    expect(html).toContain("deepseek-v4-flash")
    expect(html).toContain("OpenAI")
    expect(html).toContain("Anthropic")
    expect(html).toContain("本地文本检索")
    expect(html).toContain("语义向量检索")
    expect(html).toContain("https://mineru.net")
    expect(html).toContain("MinerU 云端解析")
    expect(html).toContain("获取 DeepSeek key")
    expect(html).toContain("https://platform.deepseek.com/api_keys")
    expect(html).toContain("获取 MinerU token")
    expect(html).toContain("https://mineru.net/apiManage/docs")
    expect(html).toContain("获取 SiliconFlow key")
    expect(html).toContain("https://cloud.siliconflow.cn/account/ak")
    expect(html).not.toContain("Provider ID")
    expect(html).not.toContain("Embedding URL")
    expect(html).not.toContain('value="2560"')
    expect(html).not.toContain("开发诊断")
    expect(html).not.toContain("运行自检")
    expect(html).not.toContain("sk-")
  })

  it("updates the provider key link when switching LLM presets", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true)

    const { container, unmount } = await renderClient(
      <LlmSettingsPanel open onClose={() => undefined} />,
    )

    expect(textContent(container)).toContain("获取 DeepSeek key")
    expect(
      container.querySelector<HTMLAnchorElement>(
        'a[href="https://platform.deepseek.com/api_keys"]',
      ),
    ).toBeInstanceOf(HTMLAnchorElement)

    await click(buttonByText(container, "OpenAI"))
    expect(textContent(container)).toContain("获取 OpenAI key")
    expect(textContent(container)).toContain("custom-openai-model")
    expect(
      container.querySelector<HTMLAnchorElement>(
        'a[href="https://platform.openai.com/api-keys"]',
      ),
    ).toBeInstanceOf(HTMLAnchorElement)

    await click(buttonByText(container, "Anthropic"))
    expect(textContent(container)).toContain("获取 Anthropic key")
    expect(textContent(container)).toContain("custom-anthropic-model")
    expect(
      container.querySelector<HTMLAnchorElement>(
        'a[href="https://console.anthropic.com/settings/keys"]',
      ),
    ).toBeInstanceOf(HTMLAnchorElement)
    expect(textContent(container)).not.toContain("sk-")
    unmount()
  })

  it("saves MinerU token from the settings panel without rendering the secret", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true)

    const { container, unmount } = await renderClient(
      <LlmSettingsPanel open onClose={() => undefined} />,
    )

    const tokenInput = inputByPlaceholder(container, "MinerU token")
    await setInputValue(tokenInput, "mineru-secret-token")
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

  it("keeps custom OpenAI and Anthropic drafts when switching providers", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true)

    const { container, unmount } = await renderClient(
      <LlmSettingsPanel open onClose={() => undefined} defaultAdvancedOpen />,
    )

    await click(buttonByText(container, "OpenAI"))
    let advancedInputs = [...container.querySelectorAll("input")]
    const openAiBaseUrl = advancedInputs.find((input) =>
      input.value.includes("proxy.example.com/openai"),
    )
    const openAiModel = advancedInputs.find((input) => input.value === "custom-openai-model")
    expect(openAiBaseUrl?.value).toBe("https://proxy.example.com/openai/v1")
    expect(openAiModel?.value).toBe("custom-openai-model")

    await setInputValue(openAiBaseUrl as HTMLInputElement, "https://gateway.local/openai/v1")
    await setInputValue(openAiModel as HTMLInputElement, "my-openai-model")
    await click(buttonByText(container, "Anthropic"))

    advancedInputs = [...container.querySelectorAll("input")]
    expect(advancedInputs.some((input) => input.value === "https://proxy.example.com/anthropic")).toBe(true)
    expect(advancedInputs.some((input) => input.value === "custom-anthropic-model")).toBe(true)

    await click(buttonByText(container, "OpenAI"))
    advancedInputs = [...container.querySelectorAll("input")]
    expect(advancedInputs.some((input) => input.value === "https://gateway.local/openai/v1")).toBe(true)
    expect(advancedInputs.some((input) => input.value === "my-openai-model")).toBe(true)
    unmount()
  })

  it("tests and persists the current LLM configuration", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    vi.mocked(testLlmConnectionWithSettings).mockResolvedValueOnce({
      provider: "open_ai",
      model: "my-openai-model",
      ok: true,
    })
    vi.mocked(saveLlmSettings).mockResolvedValueOnce({
      provider: "open_ai",
      baseUrl: "https://gateway.local/openai/v1",
      model: "my-openai-model",
      apiKeyConfigured: true,
      providers: {
        deep_seek: {
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-flash",
          apiKeyConfigured: true,
        },
        open_ai: {
          baseUrl: "https://gateway.local/openai/v1",
          model: "my-openai-model",
          apiKeyConfigured: true,
        },
        anthropic: {
          baseUrl: "https://proxy.example.com/anthropic",
          model: "custom-anthropic-model",
          apiKeyConfigured: false,
        },
      },
    })

    const onLlmSettingsSaved = vi.fn()
    const { container, unmount } = await renderClient(
      <LlmSettingsPanel
        open
        onClose={() => undefined}
        onLlmSettingsSaved={onLlmSettingsSaved}
        defaultAdvancedOpen
      />,
    )

    await click(buttonByText(container, "OpenAI"))
    const inputs = [...container.querySelectorAll("input")]
    const keyInput = inputByPlaceholder(container, "沿用已保存密钥")
    const baseUrlInput = inputs.find((input) =>
      input.value.includes("proxy.example.com/openai"),
    ) as HTMLInputElement
    const modelInput = inputs.find((input) => input.value === "custom-openai-model") as HTMLInputElement

    await setInputValue(keyInput, "unsaved-openai-key")
    await setInputValue(baseUrlInput, "https://gateway.local/openai/v1")
    await setInputValue(modelInput, "my-openai-model")
    await click(buttonByText(container, "测试并记录"))

    await vi.waitFor(() => {
      expect(testLlmConnectionWithSettings).toHaveBeenCalledWith({
        provider: "open_ai",
        baseUrl: "https://gateway.local/openai/v1",
        model: "my-openai-model",
        apiKey: "unsaved-openai-key",
      })
      expect(saveLlmSettings).toHaveBeenCalledWith({
        provider: "open_ai",
        baseUrl: "https://gateway.local/openai/v1",
        model: "my-openai-model",
        apiKey: "unsaved-openai-key",
      })
      expect(textContent(container)).toContain("OpenAI my-openai-model 连通正常，已记录为当前 LLM 设置")
      expect(onLlmSettingsSaved).toHaveBeenCalledWith({
        provider: "open_ai",
        baseUrl: "https://gateway.local/openai/v1",
        model: "my-openai-model",
        apiKeyConfigured: true,
        providers: {
          deep_seek: {
            baseUrl: "https://api.deepseek.com",
            model: "deepseek-v4-flash",
            apiKeyConfigured: true,
          },
          open_ai: {
            baseUrl: "https://gateway.local/openai/v1",
            model: "my-openai-model",
            apiKeyConfigured: true,
          },
          anthropic: {
            baseUrl: "https://proxy.example.com/anthropic",
            model: "custom-anthropic-model",
            apiKeyConfigured: false,
          },
        },
      })
    })
    expect(textContent(container)).not.toContain("unsaved-openai-key")
    unmount()
  })

  it("restores the tested Anthropic-compatible provider after reopening settings", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    const persistedSettings = {
      provider: "anthropic" as const,
      baseUrl: "https://api.minimaxi.com/anthropic",
      model: "MiniMax-M3",
      apiKeyConfigured: true,
      providers: {
        deep_seek: {
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-flash",
          apiKeyConfigured: true,
        },
        open_ai: {
          baseUrl: "https://proxy.example.com/openai/v1",
          model: "custom-openai-model",
          apiKeyConfigured: true,
        },
        anthropic: {
          baseUrl: "https://api.minimaxi.com/anthropic",
          model: "MiniMax-M3",
          apiKeyConfigured: true,
        },
      },
    }
    vi.mocked(testLlmConnectionWithSettings).mockResolvedValueOnce({
      provider: "anthropic",
      model: "MiniMax-M3",
      ok: true,
    })
    vi.mocked(saveLlmSettings).mockResolvedValueOnce(persistedSettings)

    const first = await renderClient(
      <LlmSettingsPanel open onClose={() => undefined} defaultAdvancedOpen />,
    )

    await click(buttonByText(first.container, "Anthropic"))
    const firstInputs = [...first.container.querySelectorAll("input")]
    const keyInput = inputByPlaceholder(first.container, "输入密钥后保存")
    const baseUrlInput = firstInputs.find((input) =>
      input.value.includes("proxy.example.com/anthropic"),
    ) as HTMLInputElement
    const modelInput = firstInputs.find((input) => input.value === "custom-anthropic-model") as HTMLInputElement

    await setInputValue(keyInput, "anthropic-compatible-key")
    await setInputValue(baseUrlInput, "https://api.minimaxi.com/anthropic")
    await setInputValue(modelInput, "MiniMax-M3")
    await click(buttonByText(first.container, "测试并记录"))

    await vi.waitFor(() => {
      expect(saveLlmSettings).toHaveBeenCalledWith({
        provider: "anthropic",
        baseUrl: "https://api.minimaxi.com/anthropic",
        model: "MiniMax-M3",
        apiKey: "anthropic-compatible-key",
      })
      expect(textContent(first.container)).toContain("Anthropic MiniMax-M3 连通正常，已记录为当前 LLM 设置")
    })
    first.unmount()

    vi.mocked(getLlmSettings).mockResolvedValueOnce(persistedSettings)
    const reopened = await renderClient(
      <LlmSettingsPanel open onClose={() => undefined} defaultAdvancedOpen />,
    )

    expect(textContent(reopened.container)).toContain("当前预设：Anthropic · MiniMax-M3")
    expect([...reopened.container.querySelectorAll("input")].some((input) =>
      input.value === "https://api.minimaxi.com/anthropic",
    )).toBe(true)
    expect([...reopened.container.querySelectorAll("input")].some((input) =>
      input.value === "MiniMax-M3",
    )).toBe(true)
    expect(textContent(reopened.container)).not.toContain("anthropic-compatible-key")
    reopened.unmount()
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
        batchSize: 64,
        enabled: true,
        apiKey: undefined,
      })
    })
    unmount()
  })

  it("renders structured command error suggestions when saving fails", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    vi.mocked(saveLlmSettings).mockRejectedValueOnce({
      code: "authentication",
      message: "DeepSeek API key 无效。",
      suggestion: "请重新生成 API key 后保存。",
    })

    const { container, unmount } = await renderClient(
      <LlmSettingsPanel open onClose={() => undefined} />,
    )

    await click(buttonByText(container, "保存 LLM"))

    await vi.waitFor(() => {
      expect(textContent(container)).toContain("DeepSeek API key 无效")
      expect(textContent(container)).toContain("建议：请重新生成 API key 后保存。")
    })
    expect(textContent(container)).not.toContain("authentication")
    unmount()
  })

  it("reveals advanced provider fields only after switching modes", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true)

    const { container, unmount } = await renderClient(
      <LlmSettingsPanel open onClose={() => undefined} />,
    )

    expect(textContent(container)).not.toContain("Provider ID")
    expect(textContent(container)).not.toContain("开发诊断")

    await click(buttonByText(container, "高级"))

    expect(textContent(container)).toContain("Provider ID")
    expect(textContent(container)).toContain("Embedding URL")
    expect(textContent(container)).toContain("向量维度")
    expect(textContent(container)).toContain("批大小")
    expect(textContent(container)).toContain("开发诊断")
    expect(textContent(container)).toContain("OpenAI 兼容服务填到 /v1")
    expect(textContent(container)).toContain("自定义模型")
    expect(textContent(container)).toContain("兼容 OpenAI embeddings 协议")
    expect(textContent(container)).toContain("必须匹配模型输出维度")
    unmount()
  })

  it("can save local text search mode without requiring an embedding key", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    vi.mocked(saveEmbeddingSettings).mockResolvedValueOnce({
      provider: "disabled",
      baseUrl: "https://api.siliconflow.cn/v1/embeddings",
      model: "Qwen/Qwen3-Embedding-4B",
      expectedDimension: 2560,
      batchSize: 64,
      apiKeyConfigured: false,
      enabled: false,
    })

    const { container, unmount } = await renderClient(
      <LlmSettingsPanel open onClose={() => undefined} />,
    )

    await click(buttonByText(container, "本地文本检索"))
    await click(buttonByText(container, "保存 Embedding"))

    await vi.waitFor(() => {
      expect(saveEmbeddingSettings).toHaveBeenCalledWith({
        provider: "siliconflow",
        baseUrl: "https://api.siliconflow.cn/v1/embeddings",
        model: "Qwen/Qwen3-Embedding-4B",
        expectedDimension: 2560,
        batchSize: 64,
        enabled: false,
        apiKey: undefined,
      })
    })
    expect(textContent(container)).toContain("FTS 文本搜索")
    unmount()
  })

  it("describes browser mode without exposing Tauri backend wording", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(false)

    const { container, unmount } = await renderClient(
      <LlmSettingsPanel open onClose={() => undefined} />,
    )

    expect(textContent(container)).toContain("浏览器版可查看界面")
    expect(textContent(container)).toContain("保存密钥和测试连接请使用桌面版")
    expect(statusMessages(container)).not.toContain("Tauri")
    expect(statusMessages(container)).not.toContain("后端")
    expect(getLlmSettings).not.toHaveBeenCalled()
    expect(getEmbeddingSettings).not.toHaveBeenCalled()
    expect(getMineruSettings).not.toHaveBeenCalled()

    await click(buttonByText(container, "测试"))
    expect(textContent(container)).toContain("连接测试请使用桌面版")
    expect(statusMessages(container)).not.toContain("Tauri")
    expect(statusMessages(container)).not.toContain("后端")

    await click(buttonByText(container, "保存全部"))
    expect(textContent(container)).toContain("保存设置请使用桌面版")
    expect(textContent(container)).toContain("MinerU 云端解析设置请使用桌面版保存")
    expect(statusMessages(container)).not.toContain("Tauri")
    expect(statusMessages(container)).not.toContain("后端")

    await click(buttonByText(container, "高级"))
    await click(buttonByText(container, "运行自检"))
    expect(textContent(container)).toContain("开发诊断仅桌面版可运行")
    expect(statusMessages(container)).not.toContain("Tauri")
    expect(statusMessages(container)).not.toContain("后端")
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

    expect(textContent(container)).not.toContain("产品自检")
    await click(buttonByText(container, "高级"))
    expect(textContent(container)).toContain("开发诊断")
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
