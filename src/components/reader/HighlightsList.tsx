import { Clock, Highlighter, Loader2, NotebookPen, Sparkles } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { findHighlightCardId, generatedHighlightNote } from "@/core/highlight-card"
import type { KnowledgeCard, SavedHighlight } from "@/stores/reader-store"

type HighlightsListProps = {
  highlights: SavedHighlight[]
  knowledgeCards: KnowledgeCard[]
  desktopAvailable: boolean
  onOpenHighlight?: (highlight: SavedHighlight) => void
  /** 生成/重生成高亮 AI 笔记（force=true），返回刷新后的卡片供就地展示。 */
  onGenerateNote?: (cardId: string) => Promise<KnowledgeCard | null>
  onNotice?: (message: string) => void
}

/**
 * 高亮清单：浏览已保存高亮，并把「原始高亮 → AI 笔记」这条链路落到条目上。
 * 反查到对应知识卡才显示「生成 AI 笔记」入口（知识库未构建时隐藏），生成后在
 * 条目下折叠展示 body_markdown，可重新生成。命令式副作用，不引入 useEffect。
 */
export function HighlightsList({
  highlights,
  knowledgeCards,
  desktopAvailable,
  onOpenHighlight = () => undefined,
  onGenerateNote,
  onNotice = () => undefined,
}: HighlightsListProps) {
  const [generatingId, setGeneratingId] = useState("")
  // 本次会话内刚生成的笔记，优先于从卡片推断的结果即时展示。
  const [sessionNotes, setSessionNotes] = useState<Record<string, string>>({})

  const cardByHighlightId = useMemo(() => {
    const map = new Map<string, KnowledgeCard>()
    for (const highlight of highlights) {
      const cardId = findHighlightCardId(knowledgeCards, highlight.id)
      if (!cardId) {
        continue
      }
      const card = knowledgeCards.find((item) => item.cardId === cardId)
      if (card) {
        map.set(highlight.id, card)
      }
    }
    return map
  }, [highlights, knowledgeCards])

  async function handleGenerate(highlightId: string, cardId: string) {
    if (!onGenerateNote) {
      return
    }
    setGeneratingId(highlightId)
    try {
      const card = await onGenerateNote(cardId)
      if (card) {
        setSessionNotes((prev) => ({ ...prev, [highlightId]: card.bodyMarkdown }))
      }
    } catch (error) {
      onNotice(`生成笔记失败；${error instanceof Error ? error.message : "请稍后重试"}`)
    } finally {
      setGeneratingId("")
    }
  }

  if (highlights.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center px-5 text-center">
        <span className="reader-panel-accent-bg mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full">
          <Highlighter className="h-5 w-5" />
        </span>
        <p className="reader-panel-text text-sm font-medium">还没有高亮</p>
        <p className="reader-panel-muted mt-2 max-w-64 text-sm leading-6">
          在原文里框选一段文字并高亮，之后可以在这里一键生成 AI 笔记。
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto pb-2">
      {highlights.map((highlight) => {
        const card = cardByHighlightId.get(highlight.id)
        const note = sessionNotes[highlight.id] ?? generatedHighlightNote(card, highlight.selectionText)
        const generating = generatingId === highlight.id
        const canGenerate = desktopAvailable && Boolean(onGenerateNote) && Boolean(card)
        return (
          <article
            key={highlight.id}
            className="reader-panel-border border-b px-3 py-3"
          >
            <button
              type="button"
              className="reader-panel-row block w-full rounded-md text-left transition-[background-color,transform] duration-interactive ease-reader focus:outline-none focus:ring-2 focus:ring-ring active:scale-[0.99]"
              onClick={() => onOpenHighlight(highlight)}
            >
              <span className="reader-panel-text line-clamp-3 font-reading text-sm leading-6">
                {highlight.selectionText}
              </span>
              <span className="reader-panel-muted mt-2 flex items-center gap-2 text-xs">
                {typeof highlight.pageIndex === "number" ? (
                  <span>第 {highlight.pageIndex + 1} 页</span>
                ) : null}
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatHighlightTime(highlight.createdAt)}
                </span>
              </span>
            </button>

            {canGenerate ? (
              <div className="mt-2.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={generating}
                  onClick={() => handleGenerate(highlight.id, card!.cardId)}
                >
                  {generating ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : note ? (
                    <NotebookPen className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {generating ? "生成中…" : note ? "重新生成 AI 笔记" : "生成 AI 笔记"}
                </Button>
              </div>
            ) : null}

            {note ? (
              <details open className="mt-2.5 rounded-md border bg-background px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                  AI 笔记
                </summary>
                <div className="mt-2 whitespace-pre-wrap text-xs leading-6">{note}</div>
              </details>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

function formatHighlightTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "已保存"
  }
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
