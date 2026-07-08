import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { HighlightsList } from "./HighlightsList"
import type { KnowledgeCard, SavedHighlight } from "@/stores/reader-store"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const highlight: SavedHighlight = {
  id: "hl-1",
  bookId: "book-1",
  selectionText: "复利来自时间、纪律和风险控制。",
  prefix: "",
  suffix: "",
  pageIndex: 7,
  positionStart: 0,
  positionEnd: 14,
  rects: [],
  createdAt: "2026-06-08T08:00:00.000Z",
}

const highlightCard: KnowledgeCard = {
  cardId: "kb-highlight-1",
  bookId: "book-1",
  cardType: "highlight",
  title: "复利来自时间",
  summary: highlight.selectionText,
  bodyMarkdown: highlight.selectionText,
  payloadJson: JSON.stringify({ sourceTable: "highlights", sourceId: "hl-1" }),
  status: "confirmed",
  source: "highlight",
  confidence: 1,
  sourceVersion: 1,
  userLocked: false,
  createdAt: highlight.createdAt,
  updatedAt: highlight.createdAt,
  evidence: [],
}

function findButton(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button")).find((node) =>
    node.textContent?.includes(text),
  )
}

describe("HighlightsList", () => {
  it("generates an AI note for a highlight with a resolvable card and shows it folded", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    let resolveGenerate: (card: KnowledgeCard | null) => void = () => undefined
    const onGenerateNote = vi.fn(
      () =>
        new Promise<KnowledgeCard | null>((resolve) => {
          resolveGenerate = resolve
        }),
    )

    await act(async () => {
      root.render(
        <HighlightsList
          highlights={[highlight]}
          knowledgeCards={[highlightCard]}
          desktopAvailable
          onGenerateNote={onGenerateNote}
        />,
      )
      await Promise.resolve()
    })

    const button = findButton(container, "生成 AI 笔记")
    expect(button).toBeTruthy()

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    // Loading state, and the reverse-lookup passed the sedimented card id through.
    expect(onGenerateNote).toHaveBeenCalledWith("kb-highlight-1")
    expect(container.textContent).toContain("生成中…")

    await act(async () => {
      resolveGenerate({ ...highlightCard, bodyMarkdown: "作者借复利强调长期主义。" })
      await Promise.resolve()
    })

    expect(container.textContent).toContain("作者借复利强调长期主义。")
    expect(findButton(container, "重新生成 AI 笔记")).toBeTruthy()

    root.unmount()
    container.remove()
  })

  it("hides the generate action when no card sediments from the highlight yet", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const onGenerateNote = vi.fn()

    await act(async () => {
      root.render(
        <HighlightsList
          highlights={[highlight]}
          knowledgeCards={[]}
          desktopAvailable
          onGenerateNote={onGenerateNote}
        />,
      )
      await Promise.resolve()
    })

    expect(findButton(container, "生成 AI 笔记")).toBeUndefined()
    expect(onGenerateNote).not.toHaveBeenCalled()

    root.unmount()
    container.remove()
  })

  it("surfaces generation failures through onNotice", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const onNotice = vi.fn()
    const onGenerateNote = vi.fn(async () => {
      throw new Error("LLM 未配置")
    })

    await act(async () => {
      root.render(
        <HighlightsList
          highlights={[highlight]}
          knowledgeCards={[highlightCard]}
          desktopAvailable
          onGenerateNote={onGenerateNote}
          onNotice={onNotice}
        />,
      )
      await Promise.resolve()
    })

    const button = findButton(container, "生成 AI 笔记")
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onGenerateNote).toHaveBeenCalledWith("kb-highlight-1")
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining("生成笔记失败"))
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining("LLM 未配置"))

    root.unmount()
    container.remove()
  })
})
