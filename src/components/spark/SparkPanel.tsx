import { AlertCircle, Copy, Loader2, MessageSquareText, NotebookPen, Send, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MarkdownContent } from "@/components/markdown/MarkdownContent"
import { shouldSubmitTextarea } from "@/components/reader/textarea-submit"
import type { AnswerSource, FollowUpTurn, SavedInterpretation } from "@/stores/reader-store"

export type SparkPanelMode = "spark" | "note"

export type SparkPanelProps = {
  mode: SparkPanelMode
  selectionText: string
  answer: string
  answerSource?: AnswerSource
  followUps: FollowUpTurn[]
  noteDraft: string
  question: string
  noteItems?: SavedInterpretation[]
  loading?: boolean
  error?: string
  citationChunkIds?: string[]
  onModeChange: (mode: SparkPanelMode) => void
  onNoteDraftChange: (value: string) => void
  onQuestionChange: (value: string) => void
  onSaveNote: () => void
  onAsk: () => void
  onClose: () => void
  onCopy?: () => void
  onCitationClick?: (chunkId: string) => void
}

export function SparkPanel({
  mode,
  selectionText,
  answer,
  answerSource = "llm",
  followUps,
  noteDraft,
  question,
  noteItems = [],
  loading = false,
  error = "",
  citationChunkIds = [],
  onModeChange,
  onNoteDraftChange,
  onQuestionChange,
  onSaveNote,
  onAsk,
  onClose,
  onCopy,
  onCitationClick,
}: SparkPanelProps) {
  const hasSparkContent = answer.trim() || followUps.length > 0
  const noteRows = noteItems.filter((item) => (item.kind ?? "interpretation") === "note")
  const sparkRows = noteItems.filter((item) => (item.kind ?? "interpretation") === "spark")
  return (
    <div className="flex min-h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <div className="text-sm font-semibold">Spark</div>
          <Badge variant="secondary">{mode === "spark" ? "AI" : "Note"}</Badge>
        </div>
        <Button size="icon" variant="ghost" aria-label="关闭 Spark" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="mb-3 rounded-md border bg-background p-3">
        <div className="mb-1 text-xs font-medium text-muted-foreground">选区</div>
        <p className="line-clamp-5 text-sm leading-6">{selectionText || "先框选一段文字"}</p>
      </div>

      <div className="mb-3 grid grid-cols-2 rounded-md border bg-background p-1">
        <Button
          size="sm"
          variant={mode === "spark" ? "secondary" : "ghost"}
          className="h-8"
          onClick={() => onModeChange("spark")}
        >
          <MessageSquareText className="mr-1.5 h-4 w-4" />
          AI Spark
        </Button>
        <Button
          size="sm"
          variant={mode === "note" ? "secondary" : "ghost"}
          className="h-8"
          onClick={() => onModeChange("note")}
        >
          <NotebookPen className="mr-1.5 h-4 w-4" />
          Note
        </Button>
      </div>

      {mode === "note" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-background p-3">
            {noteItems.length > 0 ? (
              <div className="space-y-4">
                {sparkRows.length > 0 ? (
                  <div className="space-y-3 rounded-md border bg-muted/25 p-3">
                    <div className="text-xs font-medium text-muted-foreground">AI Spark</div>
                    {sparkRows.map((item) => (
                      <NoteHistoryItem
                        key={item.id}
                        item={item}
                        citationChunkIds={citationChunkIds}
                        onCitationClick={onCitationClick}
                      />
                    ))}
                  </div>
                ) : null}
                {noteRows.map((item) => (
                  <NoteHistoryItem
                    key={item.id}
                    item={item}
                    citationChunkIds={citationChunkIds}
                    onCitationClick={onCitationClick}
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-32 items-center justify-center text-center text-sm text-muted-foreground">
                这个选区还没有保存过 Spark 或 Note。
              </div>
            )}
          </div>
          <textarea
            className="min-h-32 resize-none rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring"
            placeholder="用 Markdown 写下这段文字触发的想法"
            value={noteDraft}
            onChange={(event) => onNoteDraftChange(event.target.value)}
          />
          {error ? <PanelError message={error} /> : null}
          <Button disabled={!selectionText.trim() || !noteDraft.trim() || loading} onClick={onSaveNote}>
            {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <NotebookPen className="mr-1.5 h-4 w-4" />}
            保存 Note
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-background p-3">
            {loading && !hasSparkContent ? (
              <div className="space-y-2">
                <div className="h-3 w-11/12 rounded bg-muted reader-shimmer" />
                <div className="h-3 w-9/12 rounded bg-muted reader-shimmer" />
                <div className="h-3 w-10/12 rounded bg-muted reader-shimmer" />
              </div>
            ) : hasSparkContent ? (
              <div className="space-y-4">
                {answer.trim() ? (
                  <div>
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      首轮 Spark
                      {answerSource === "local_fallback" ? <Badge variant="secondary">本地兜底</Badge> : null}
                    </div>
                    <MarkdownContent
                      content={answer}
                      citationChunkIds={citationChunkIds}
                      onCitationClick={onCitationClick}
                      className="text-sm leading-6"
                    />
                  </div>
                ) : null}
                {followUps.map((turn) => (
                  <div key={turn.id} className="space-y-1 border-t pt-3">
                    <div className="rounded-md bg-muted px-3 py-2 text-sm">{turn.question}</div>
                    <MarkdownContent
                      content={turn.answer}
                      citationChunkIds={citationChunkIds}
                      onCitationClick={onCitationClick}
                      className="text-sm leading-6"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center text-center text-sm text-muted-foreground">
                <Sparkles className="mb-3 h-8 w-8" />
                <div>用 Spark 钉住这段选区，进行轻量多轮陪读。</div>
              </div>
            )}
          </div>
          {error ? <PanelError message={error} /> : null}
          <div className="flex gap-2">
            <textarea
              className="min-h-16 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder={hasSparkContent ? "继续追问" : "输入一个 Spark 问题，留空则生成轻量解释"}
              value={question}
              onChange={(event) => onQuestionChange(event.target.value)}
              onKeyDown={(event) => {
                if (shouldSubmitTextarea(event)) {
                  event.preventDefault()
                  onAsk()
                }
              }}
            />
            <div className="flex flex-col gap-2">
              <Button size="icon" variant="ghost" aria-label="复制 Spark" onClick={onCopy}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button size="icon" disabled={!selectionText.trim() || loading} aria-label="发送 Spark" onClick={onAsk}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NoteHistoryItem({
  item,
  citationChunkIds,
  onCitationClick,
}: {
  item: SavedInterpretation
  citationChunkIds: string[]
  onCitationClick?: (chunkId: string) => void
}) {
  const kind = item.kind ?? "interpretation"
  const label = kind === "note" ? "Note" : item.question ? "Spark 追问" : "首轮 Spark"
  return (
    <article className="space-y-2 border-b pb-4 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="text-[11px] text-muted-foreground">{formatSavedAt(item.createdAt)}</div>
      </div>
      {item.question ? (
        <div className="rounded-md bg-muted px-3 py-2 text-sm">{item.question}</div>
      ) : null}
      <MarkdownContent
        content={item.answer}
        citationChunkIds={citationChunkIds}
        onCitationClick={onCitationClick}
        className="text-sm leading-6"
      />
    </article>
  )
}

function formatSavedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function PanelError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-900">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
