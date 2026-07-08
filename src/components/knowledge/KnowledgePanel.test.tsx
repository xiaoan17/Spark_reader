import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { KnowledgePanel } from "./KnowledgePanel"
import type { KnowledgeSearchHit } from "@/core/library-api"
import type { KnowledgeCard, KnowledgeGraph } from "@/stores/reader-store"

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

const emptyCard: KnowledgeCard = {
  cardId: "kb-empty-1",
  bookId: "book-test",
  cardType: "concept",
  title: "复利（待补）",
  summary: "",
  bodyMarkdown: "",
  payloadJson: "{}",
  status: "candidate",
  source: "auto",
  confidence: 0.7,
  sourceVersion: 1,
  userLocked: false,
  createdAt: "2026-06-07T10:00:00Z",
  updatedAt: "2026-06-07T10:00:00Z",
  evidence: [],
}

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const card: KnowledgeCard = {
  cardId: "kb-card-1",
  bookId: "book-test",
  cardType: "interpretation",
  title: "复利来自时间",
  summary: "作者强调长期过程。",
  bodyMarkdown: "作者强调长期过程。",
  payloadJson: "{}",
  status: "confirmed",
  source: "interpretation",
  confidence: 0.9,
  sourceVersion: 1,
  userLocked: false,
  createdAt: "2026-06-07T10:00:00Z",
  updatedAt: "2026-06-07T10:00:00Z",
  evidence: [
    {
      cardId: "kb-card-1",
      bookId: "book-test",
      chunkId: "b12345678-p1-c1-abcdef12",
      pageIndex: 0,
      quote: "复利来自时间、纪律和风险控制。",
      role: "support",
      contentHash: "abcdef12",
      createdAt: "2026-06-07T10:00:00Z",
    },
  ],
}

const graph: KnowledgeGraph = {
  bookId: "book-test",
  builtAt: "2026-06-07T10:10:00Z",
  nodes: [
    {
      cardId: card.cardId,
      bookId: card.bookId,
      cardType: card.cardType,
      title: card.title,
      summary: card.summary,
      status: card.status,
      source: card.source,
      confidence: card.confidence,
      evidenceCount: card.evidence.length,
      pageIndex: 0,
      evidence: card.evidence,
    },
    {
      cardId: "kb-auto-1",
      bookId: "book-test",
      cardType: "concept",
      title: "复利",
      summary: "自动候选：复利。",
      status: "candidate",
      source: "auto",
      confidence: 0.72,
      evidenceCount: 1,
      pageIndex: 0,
      evidence: card.evidence,
    },
  ],
  edges: [
    {
      edgeId: "edge-1",
      bookId: "book-test",
      sourceCardId: "kb-card-1",
      targetCardId: "kb-auto-1",
      edgeType: "mentions",
      label: "提及候选",
      evidenceChunkIds: [card.evidence[0].chunkId],
      source: "auto",
      confidence: 0.7,
      status: "candidate",
      createdAt: "2026-06-07T10:10:00Z",
      updatedAt: "2026-06-07T10:10:00Z",
    },
  ],
}

describe("KnowledgePanel", () => {
  it("calls evidence click with the source chunk id", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const onEvidenceClick = vi.fn()

    await act(async () => {
      root.render(<KnowledgePanel cards={[card]} onEvidenceClick={onEvidenceClick} />)
      await Promise.resolve()
    })

    // The raw chunk id must not leak into the visible label (BRAND §7); it stays
    // available only via the title attribute for proofreading.
    expect(container.textContent).not.toContain(card.evidence[0].chunkId)
    const evidenceButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.getAttribute("title")?.includes(card.evidence[0].chunkId),
    )
    expect(evidenceButton).toBeTruthy()

    await act(async () => {
      evidenceButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(onEvidenceClick).toHaveBeenCalledWith(card.evidence[0].chunkId)
    root.unmount()
    container.remove()
  })

  it("calls build knowledge from the build action", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const onBuildKnowledge = vi.fn()

    await act(async () => {
      root.render(
        <KnowledgePanel cards={[card]} graph={graph} onBuildKnowledge={onBuildKnowledge} />,
      )
      await Promise.resolve()
    })

    const buildButton = container.querySelector('button[aria-label="构建知识体系"]')
    expect(buildButton).toBeTruthy()

    await act(async () => {
      buildButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(onBuildKnowledge).toHaveBeenCalled()
    root.unmount()
    container.remove()
  })

  it("calls build knowledge from an empty knowledge state", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const onBuildKnowledge = vi.fn()

    await act(async () => {
      root.render(<KnowledgePanel cards={[]} onBuildKnowledge={onBuildKnowledge} />)
      await Promise.resolve()
    })

    const buildButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("从整本书生成"),
    )
    expect(buildButton).toBeTruthy()

    await act(async () => {
      buildButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(onBuildKnowledge).toHaveBeenCalled()
    root.unmount()
    container.remove()
  })

  it("calls evidence click from graph edges", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const onEvidenceClick = vi.fn()

    await act(async () => {
      root.render(
        <KnowledgePanel cards={[card]} graph={graph} onEvidenceClick={onEvidenceClick} />,
      )
      await Promise.resolve()
    })

    const graphTab = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("图谱"),
    )
    await act(async () => {
      graphTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    const evidenceButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.getAttribute("title")?.includes(card.evidence[0].chunkId),
    )
    expect(evidenceButton).toBeTruthy()

    await act(async () => {
      evidenceButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(onEvidenceClick).toHaveBeenCalledWith(card.evidence[0].chunkId)
    root.unmount()
    container.remove()
  })

  it("exports the knowledge book to Obsidian from the header action", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const onExportObsidian = vi.fn()

    await act(async () => {
      root.render(
        <KnowledgePanel cards={[card]} graph={graph} onExportObsidian={onExportObsidian} />,
      )
      await Promise.resolve()
    })

    const obsidianButton = container.querySelector('button[aria-label="导出到 Obsidian"]')
    expect(obsidianButton).toBeTruthy()

    await act(async () => {
      obsidianButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(onExportObsidian).toHaveBeenCalledTimes(1)
    root.unmount()
    container.remove()
  })

  it("omits the Obsidian action when no handler is provided", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<KnowledgePanel cards={[card]} graph={graph} />)
      await Promise.resolve()
    })

    expect(container.querySelector('button[aria-label="导出到 Obsidian"]')).toBeNull()
    root.unmount()
    container.remove()
  })

  it("renders backlinks and chapter map views", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<KnowledgePanel cards={[card]} graph={graph} />)
      await Promise.resolve()
    })

    const backlinksTab = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("反链"),
    )
    await act(async () => {
      backlinksTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })
    expect(container.textContent).toContain("条反链")

    const mapTab = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("地图"),
    )
    await act(async () => {
      mapTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })
    expect(container.textContent).toContain("第 1 页")

    root.unmount()
    container.remove()
  })

  it("filters cards to search hits and calls the search command with the query", async () => {
    vi.useFakeTimers()
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const other: KnowledgeCard = { ...card, cardId: "kb-card-2", title: "风险控制" }
    const onSearchKnowledge = vi.fn(
      async (): Promise<KnowledgeSearchHit[]> => [
        {
          cardId: other.cardId,
          title: other.title,
          cardType: other.cardType,
          status: other.status,
          source: other.source,
          confidence: other.confidence,
          score: 1,
          evidenceChunkIds: [],
        },
      ],
    )

    await act(async () => {
      root.render(
        <KnowledgePanel
          cards={[card, other]}
          desktopAvailable
          onSearchKnowledge={onSearchKnowledge}
        />,
      )
      await Promise.resolve()
    })

    const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索知识卡片"]')
    expect(input).toBeTruthy()

    await act(async () => {
      setInputValue(input!, "风险")
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(onSearchKnowledge).toHaveBeenCalledWith("风险")
    // Only the hit card remains; the non-matching card is filtered out of the list.
    const titles = Array.from(container.querySelectorAll("h3")).map((node) => node.textContent)
    expect(titles).toContain("风险控制")
    expect(titles).not.toContain("复利来自时间")

    vi.useRealTimers()
    root.unmount()
    container.remove()
  })

  it("shows an empty state when the search returns no hits", async () => {
    vi.useFakeTimers()
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const onSearchKnowledge = vi.fn(async (): Promise<KnowledgeSearchHit[]> => [])

    await act(async () => {
      root.render(
        <KnowledgePanel cards={[card]} desktopAvailable onSearchKnowledge={onSearchKnowledge} />,
      )
      await Promise.resolve()
    })

    const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索知识卡片"]')
    await act(async () => {
      setInputValue(input!, "不存在的词")
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(container.textContent).toContain("未找到")

    vi.useRealTimers()
    root.unmount()
    container.remove()
  })

  it("generates a card summary and shows a loading state", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    let resolveGenerate: () => void = () => undefined
    const onGenerateCardSummary = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveGenerate = resolve
        }),
    )

    await act(async () => {
      root.render(
        <KnowledgePanel
          cards={[emptyCard]}
          desktopAvailable
          onGenerateCardSummary={onGenerateCardSummary}
        />,
      )
      await Promise.resolve()
    })

    const button = Array.from(container.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("生成摘要"),
    )
    expect(button).toBeTruthy()

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(onGenerateCardSummary).toHaveBeenCalledWith(emptyCard.cardId)
    expect(container.textContent).toContain("生成摘要中…")

    await act(async () => {
      resolveGenerate()
      await Promise.resolve()
    })
    expect(container.textContent).not.toContain("生成摘要中…")

    root.unmount()
    container.remove()
  })

  it("generates a highlight note and surfaces failures through onNotice", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const onNotice = vi.fn()
    const onGenerateHighlightNote = vi.fn(async () => {
      throw new Error("LLM 未配置")
    })

    await act(async () => {
      root.render(
        <KnowledgePanel
          cards={[emptyCard]}
          desktopAvailable
          onGenerateHighlightNote={onGenerateHighlightNote}
          onNotice={onNotice}
        />,
      )
      await Promise.resolve()
    })

    const button = Array.from(container.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("生成笔记"),
    )
    expect(button).toBeTruthy()

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onGenerateHighlightNote).toHaveBeenCalledWith(emptyCard.cardId)
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining("生成笔记失败"))
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining("LLM 未配置"))

    root.unmount()
    container.remove()
  })
})
