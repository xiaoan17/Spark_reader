import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { Languages, Loader2, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { MarkdownContent } from "@/components/markdown/MarkdownContent"
import type { NormalizedPageRect } from "@/core/coordinates"
import type { TranslationStatus } from "@/core/library-api"
import type { ParsedPage, SavedHighlight, SavedInterpretation, TextSelectionAnchor } from "@/stores/reader-store"
import { shouldRenderCurrentTextSelection } from "./current-selection"
import type { ConvertedTextOutlineTarget } from "./ConvertedTextReader"
import {
  selectedTextFromRanges,
  selectionRangesWithin,
  selectionToolbarPositionFromRanges,
} from "./dom-selection"
import { SelectionToolbarHost } from "./SelectionToolbarHost"
import { SparkMarginDots, sparkItemBelongsToPage, sparkItemHighlight } from "./SparkMarginDots"
import { textSelectionAnchorFromDom as textSelectionAnchorFromDomSelection } from "./text-selection-anchor"
import {
  alignedTranslationRows,
  sanitizeDisplayedTranslationMarkdown,
} from "./translation-alignment"
import {
  buildVirtualPageMetrics,
  virtualPageIndexAtOffset,
  virtualPageItems,
} from "./virtual-pages"
import { translationPageClassName } from "./translation-page-class"
import { useVirtualPageMeasurements } from "./use-virtual-page-measurements"
import {
  cancelReaderAnimationFrame,
  clearProgrammaticPageScroll,
  consumeVisiblePageUpdateFromReaderScroll,
  isPageNearReaderAnchor,
  reportVisiblePageFromReaderScroll,
  requestReaderAnimationFrame,
  scrollElementIntoScrollerView,
  scrollVirtualPageIntoScrollerView,
  shouldDeferVisiblePageUpdateForProgrammaticScroll,
  startProgrammaticPageScroll,
  type ProgrammaticPageScroll,
} from "./reader-scroll"
import { cleanPdfLineBreaks } from "./reader-text"

const STORED_BOOK_PAGE_WINDOW_PREFETCH = 16

export type TranslationReaderProps = {
  pages: ParsedPage[]
  outlineTarget?: ConvertedTextOutlineTarget | null
  currentPage: number
  totalPages: number
  translation: TranslationStatus | null
  busy: boolean
  message: string
  selectionText: string
  selectionRects: NormalizedPageRect[]
  selectionAnchor: TextSelectionAnchor | null
  sparkItems?: SavedInterpretation[]
  onCurrentPageChange: (page: number) => void
  onStart: () => void
  onRetranslate: () => void
  onRetryFailed: () => void
  onCancel: () => void
  onExplain: () => void
  onPlainExplain: () => void
  onOpenSparkItem?: (item: SavedInterpretation) => void
  onHighlight: () => void
  onTextSelection: (
    text: string,
    pageNumber: number,
    anchor?: TextSelectionAnchor | null,
  ) => void
  onClearSelection: () => void
  onPageWindowRequest?: (startPage: number, pageCount: number) => void
}

export function TranslationReader({
  pages,
  outlineTarget = null,
  currentPage,
  totalPages,
  translation,
  busy,
  message,
  selectionText,
  selectionRects,
  selectionAnchor,
  sparkItems = [],
  onCurrentPageChange,
  onStart,
  onRetranslate,
  onRetryFailed,
  onCancel,
  onExplain,
  onPlainExplain,
  onOpenSparkItem,
  onHighlight,
  onTextSelection,
  onClearSelection,
  onPageWindowRequest,
}: TranslationReaderProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const paneRefs = useRef(new Map<string, HTMLElement>())
  const paneRefCallbacksRef = useRef(new Map<string, (element: HTMLElement | null) => void>())
  const pageRefCallbacksRef = useRef(new Map<number, (element: HTMLElement | null) => void>())
  const toolbarSelectionRef = useRef<{ ranges: Range[]; articleElement: HTMLElement | null } | null>(null)
  const currentPageRef = useRef(currentPage)
  const observedPageChangeRef = useRef<number | null>(null)
  const programmaticScrollRef = useRef<ProgrammaticPageScroll | null>(null)
  const handledOutlineTargetRef = useRef("")
  const [toolbarPosition, setToolbarPosition] = useState<{ left: number; top: number } | null>(null)
  const [toolbarSize, setToolbarSize] = useState<{ width: number; height: number } | null>(null)
  const [toolbarSuppressed, setToolbarSuppressed] = useState(false)
  const [virtualScroll, setVirtualScroll] = useState({ top: 0, height: 900 })
  const {
    pageRefs,
    measuredPageHeights,
    getPageMeasurementRef,
    resetMeasuredPageHeights,
  } = useVirtualPageMeasurements()
  const virtualPageCount = Math.max(totalPages, pages.length)
  const pagesByIndex = useMemo(
    () => new Map(pages.map((page) => [page.pageIndex, page])),
    [pages],
  )
  const virtualMetrics = useMemo(
    () =>
      buildVirtualPageMetrics({
        count: virtualPageCount,
        estimatedHeight: 760,
        gap: 0,
        measuredHeights: measuredPageHeights,
      }),
    [measuredPageHeights, virtualPageCount],
  )
  const renderedPages = useMemo(
    () =>
      virtualPageItems({
        metrics: virtualMetrics,
        scrollTop: virtualScroll.top,
        viewportHeight: virtualScroll.height,
        overscan: 1400,
      }),
    [virtualMetrics, virtualScroll],
  )
  const translationPages = useMemo(() => {
    const byPage = new Map<number, TranslationStatus["pages"][number]>()
    for (const page of translation?.pages ?? []) {
      byPage.set(page.pageIndex, page)
    }
    return byPage
  }, [translation])
  const progress =
    translation && translation.totalPages > 0
      ? Math.round((translation.completedPages / translation.totalPages) * 100)
      : 0
  const translationComplete = isTranslationComplete(translation)
  const hasFailedPages = Boolean(translation && translation.failedPages > 0)
  const hasCachedPages = Boolean(translation && translation.completedPages > 0)
  const showStatusMessage = Boolean(message && (busy || translation?.running || !translationComplete))
  const primaryActionLabel = hasCachedPages ? "继续翻译" : "开始翻译"

  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])

  useEffect(() => () => clearProgrammaticPageScroll(programmaticScrollRef), [])

  useEffect(() => {
    if (!selectionText.trim()) {
      setToolbarPosition(null)
      setToolbarSuppressed(false)
    }
  }, [selectionText])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) {
      return
    }
    let scrollFrame = 0
    const syncScroll = () => {
      const nextHeight = scroller.clientHeight || scroller.getBoundingClientRect().height || 900
      setVirtualScroll((state) =>
        state.top === scroller.scrollTop && state.height === nextHeight
          ? state
          : { top: scroller.scrollTop, height: nextHeight },
      )
      if (
        shouldDeferVisiblePageUpdateForProgrammaticScroll(
          programmaticScrollRef,
          scroller,
          pageRefs,
          currentPageRef,
          onCurrentPageChange,
        )
      ) {
        return
      }

      const scrollerRect = scroller.getBoundingClientRect()
      const viewportAnchor = scrollerRect.top + Math.min(180, scrollerRect.height * 0.28)
      let bestPage = currentPageRef.current
      let bestDistance = Number.POSITIVE_INFINITY
      for (const [pageIndex, element] of pageRefs.current) {
        const rect = element.getBoundingClientRect()
        if (rect.bottom < scrollerRect.top || rect.top > scrollerRect.bottom) {
          continue
        }
        const distance = Math.abs(rect.top - viewportAnchor)
        if (distance < bestDistance) {
          bestDistance = distance
          bestPage = pageIndex + 1
        }
      }
      if (bestDistance === Number.POSITIVE_INFINITY) {
        bestPage =
          virtualPageIndexAtOffset(
            virtualMetrics,
            scroller.scrollTop + Math.min(180, nextHeight * 0.28),
            currentPageRef.current - 1,
          ) + 1
      }
      if (bestPage !== currentPageRef.current) {
        currentPageRef.current = bestPage
        reportVisiblePageFromReaderScroll(observedPageChangeRef, bestPage, onCurrentPageChange)
      }
    }
    const handleScroll = () => {
      if (scrollFrame !== 0) {
        return
      }
      scrollFrame = requestReaderAnimationFrame(() => {
        scrollFrame = 0
        syncScroll()
      })
    }
    scroller.addEventListener("scroll", handleScroll, { passive: true })
    syncScroll()
    return () => {
      scroller.removeEventListener("scroll", handleScroll)
      cancelReaderAnimationFrame(scrollFrame)
    }
  }, [onCurrentPageChange, virtualMetrics])

  useEffect(() => {
    if (!onPageWindowRequest || renderedPages.length === 0) {
      return
    }
    const pageMap = new Map(pages.map((page) => [page.pageIndex, page]))
    let missingStart: number | null = null
    let missingEnd = -1
    for (const item of renderedPages) {
      const page = pageMap.get(item.index)
      if (page && page.loaded !== false) {
        continue
      }
      missingStart = missingStart === null ? item.index : Math.min(missingStart, item.index)
      missingEnd = Math.max(missingEnd, item.index)
    }
    if (missingStart === null) {
      return
    }
    const start = Math.max(0, missingStart - STORED_BOOK_PAGE_WINDOW_PREFETCH)
    const end = Math.min(totalPages, missingEnd + STORED_BOOK_PAGE_WINDOW_PREFETCH + 1)
    onPageWindowRequest(start, Math.max(1, end - start))
  }, [onPageWindowRequest, pages, renderedPages, totalPages])

  useEffect(() => {
    const target = pageRefs.current.get(currentPage - 1)
    const scroller = scrollerRef.current
    if (!scroller || totalPages <= 0) {
      return
    }
    if (consumeVisiblePageUpdateFromReaderScroll(observedPageChangeRef, currentPage)) {
      return
    }
    if (target && isPageNearReaderAnchor(scroller, target)) {
      return
    }
    let targetTop: number
    if (target) {
      targetTop = scrollElementIntoScrollerView(scroller, target, { behavior: "auto", topOffset: 0 })
    } else {
      targetTop = scrollVirtualPageIntoScrollerView(scroller, virtualMetrics, currentPage - 1, {
        behavior: "auto",
        topOffset: 0,
      })
    }
    startProgrammaticPageScroll(programmaticScrollRef, currentPage, targetTop, scroller)
    // Intentionally keyed to page intent, not measurement-only virtual metric updates.
    // While naturally scrolling, mounted page heights change as rows load and would otherwise snap back to page top.
  }, [currentPage, totalPages])

  useEffect(() => {
    if (!outlineTarget) {
      handledOutlineTargetRef.current = ""
      return
    }
    if (handledOutlineTargetRef.current === outlineTarget.requestId) {
      return
    }
    const scroller = scrollerRef.current
    if (!scroller) {
      return
    }

    const page = pagesByIndex.get(outlineTarget.pageIndex)
    const mountedPage = pageRefs.current.get(outlineTarget.pageIndex)
    if (!mountedPage) {
      const targetTop = scrollVirtualPageIntoScrollerView(
        scroller,
        virtualMetrics,
        outlineTarget.pageIndex,
        { behavior: "auto", topOffset: 0 },
      )
      startProgrammaticPageScroll(
        programmaticScrollRef,
        outlineTarget.pageIndex + 1,
        targetTop,
        scroller,
      )
      return
    }

    const frame = requestReaderAnimationFrame(() => {
      const anchor = findOutlineAnchor(scroller, outlineTarget.entryId)
      if (anchor) {
        const targetTop = scrollElementIntoScrollerView(scroller, anchor, {
          behavior: "auto",
          topOffset: 96,
        })
        startProgrammaticPageScroll(
          programmaticScrollRef,
          outlineTarget.pageIndex + 1,
          targetTop,
          scroller,
        )
        handledOutlineTargetRef.current = outlineTarget.requestId
        return
      }

      if (page?.loaded === false) {
        return
      }

      const targetTop = scrollElementIntoScrollerView(scroller, mountedPage, {
        behavior: "auto",
        topOffset: 0,
      })
      startProgrammaticPageScroll(
        programmaticScrollRef,
        outlineTarget.pageIndex + 1,
        targetTop,
        scroller,
      )
      handledOutlineTargetRef.current = outlineTarget.requestId
    })
    return () => cancelReaderAnimationFrame(frame)
  }, [outlineTarget, pagesByIndex, renderedPages, virtualMetrics])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) {
      return
    }
    const syncViewport = () => {
      const nextHeight = scroller.clientHeight || scroller.getBoundingClientRect().height || 900
      setVirtualScroll((state) =>
        state.top === scroller.scrollTop && state.height === nextHeight
          ? state
          : { top: scroller.scrollTop, height: nextHeight },
      )
    }
    syncViewport()
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncViewport)
      return () => window.removeEventListener("resize", syncViewport)
    }
    const observer = new ResizeObserver(syncViewport)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    resetMeasuredPageHeights({ preserveExisting: true })
  }, [pages, translation, resetMeasuredPageHeights])

  function clearTranslationPageRefs(pageIndex: number, element: HTMLElement | null) {
    if (!element) {
      paneRefs.current.delete(translationPaneKey(pageIndex, "source"))
      paneRefs.current.delete(translationPaneKey(pageIndex, "translation"))
    }
  }

  function getTranslationPageRef(pageIndex: number) {
    const existing = pageRefCallbacksRef.current.get(pageIndex)
    if (existing) {
      return existing
    }
    const measurementRef = getPageMeasurementRef(pageIndex)
    const callback = (element: HTMLElement | null) => {
      measurementRef(element)
      clearTranslationPageRefs(pageIndex, element)
    }
    pageRefCallbacksRef.current.set(pageIndex, callback)
    return callback
  }

  function getTranslationPaneRef(pageIndex: number, kind: "source" | "translation") {
    const key = translationPaneKey(pageIndex, kind)
    const existing = paneRefCallbacksRef.current.get(key)
    if (existing) {
      return existing
    }
    const callback = (element: HTMLElement | null) => {
      if (element) {
        paneRefs.current.set(key, element)
      } else {
        paneRefs.current.delete(key)
      }
    }
    paneRefCallbacksRef.current.set(key, callback)
    return callback
  }

  function clearReadableSelection() {
    const nativeSelection = window.getSelection()
    const hasNativeSelection = Boolean(nativeSelection?.toString().trim() || !nativeSelection?.isCollapsed)
    window.getSelection()?.removeAllRanges()
    toolbarSelectionRef.current = null
    setToolbarPosition(null)
    setToolbarSuppressed(false)
    if (selectionText.trim() || selectionRects.length > 0 || hasNativeSelection) {
      onClearSelection()
    }
  }

  const handleToolbarSizeChange = useCallback((size: { width: number; height: number }) => {
    setToolbarSize(size)
    const selectionAnchor = toolbarSelectionRef.current
    const nextPosition = selectionAnchor
      ? selectionToolbarPositionFromRanges(selectionAnchor.ranges, selectionAnchor.articleElement, size)
      : null
    if (nextPosition) {
      setToolbarPosition(nextPosition)
    }
  }, [])

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (shouldIgnoreSelectionClearTarget(event.target)) {
      return
    }
    setToolbarSuppressed(true)
    setToolbarPosition(null)
    toolbarSelectionRef.current = null
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLElement>, page: ParsedPage) {
    if (shouldIgnoreSelectionClearTarget(event.target)) {
      return
    }
    window.setTimeout(() => {
      const selection = window.getSelection()
      const article = pageRefs.current.get(page.pageIndex) ?? null
      const pane = selectionPaneForPageSelection(selection, page.pageIndex, paneRefs.current)
      const ranges = selectionRangesWithin(selection, pane)
      const text = selectedTextFromRanges(ranges)
      if (selection && text) {
        onTextSelection(
          text,
          page.pageIndex + 1,
          pane ? textSelectionAnchorFromDomSelection(selection, pane.textContent ?? "", page.pageIndex, pane) : null,
        )
        toolbarSelectionRef.current = { ranges, articleElement: article }
        setToolbarPosition(selectionToolbarPositionFromRanges(ranges, article, toolbarSize))
        setToolbarSuppressed(false)
        return
      }
      clearReadableSelection()
    }, 0)
  }

  function handleBackgroundPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (isInsideTranslationPage(event.target)) {
      return
    }
    handlePointerDown(event)
  }

  function handleBackgroundPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (shouldIgnoreSelectionClearTarget(event.target) || isInsideTranslationPage(event.target)) {
      return
    }
    window.setTimeout(() => {
      if (!window.getSelection()?.toString().trim()) {
        clearReadableSelection()
      }
    }, 0)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="shrink-0 border-b bg-card/95 px-6 py-2.5 shadow-sm backdrop-blur"
        data-translation-toolbar
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <Languages className="h-4 w-4 shrink-0" />
              <span className="shrink-0">对照翻译</span>
              {translation?.running ? (
                <Badge variant="secondary">后台翻译中</Badge>
              ) : translationComplete ? (
                <Badge variant="secondary">本地缓存</Badge>
              ) : hasFailedPages ? (
                <Badge variant="secondary">有失败页</Badge>
              ) : null}
            </div>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="truncate">{translationStatusSummary(translation)}</span>
              {showStatusMessage ? (
                <>
                  <span className="hidden text-muted-foreground/50 sm:inline">·</span>
                  <span className="truncate">{message}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {!translationComplete ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || translation?.running}
                onClick={onStart}
              >
                {busy ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Languages className="mr-1.5 h-4 w-4" />
                )}
                {primaryActionLabel}
              </Button>
            ) : null}
            {hasFailedPages ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || translation?.running}
                onClick={onRetryFailed}
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                重试失败
              </Button>
            ) : null}
            {translation && !translation.running ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={onRetranslate}>
                <RefreshCw className="mr-1.5 h-4 w-4" />
                重新翻译
              </Button>
            ) : null}
            {translation?.running ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
                取消
              </Button>
            ) : null}
          </div>
        </div>
        {translation && !translationComplete ? (
          <div className="mx-auto mt-2 max-w-6xl">
            <Progress value={progress} className="h-1" />
          </div>
        ) : null}
      </div>

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-6"
        data-translation-scroller
        onPointerDown={handleBackgroundPointerDown}
        onPointerUp={handleBackgroundPointerUp}
      >
        <div className="relative mx-auto max-w-6xl" style={{ height: virtualMetrics.totalHeight }}>
          {renderedPages.map((virtualPage) => {
            const page = pagesByIndex.get(virtualPage.index)
            if (!page || page.loaded === false) {
              return (
                <TranslationPagePlaceholder
                  key={`translation-placeholder-${virtualPage.index}`}
                  pageIndex={virtualPage.index}
                  totalPages={virtualPageCount}
                  top={virtualPage.offsetTop}
                  minHeight={virtualPage.height}
                  ref={getPageMeasurementRef(virtualPage.index)}
                />
              )
            }
            const translatedPage = translationPages.get(page.pageIndex)
            const sourceMarkdown = translationSourceMarkdown(page)
            const headingAnchor =
              outlineTarget?.pageIndex === page.pageIndex && outlineTarget.anchorText
                ? { id: outlineTarget.entryId, text: outlineTarget.anchorText }
                : null
            const translatedMarkdown =
              translatedPage?.status === "done"
                ? sanitizeDisplayedTranslationMarkdown(
                    translatedPage.translatedMarkdown,
                    sourceMarkdown,
                  )
                : ""
            const alignedRows = alignedTranslationRows(sourceMarkdown, translatedMarkdown)
            const shouldShowToolbarForPage = shouldRenderCurrentTextSelection(
              page.pageIndex,
              currentPage,
              selectionText,
              selectionAnchor,
              selectionRects,
            )
            const sourceHighlights = translationSourceHighlights({
              pageIndex: page.pageIndex,
              sparkItems,
              selectionText,
              selectionAnchor,
              shouldShowToolbarForPage,
            })
            return (
              <article
                key={page.pageIndex}
                ref={getTranslationPageRef(page.pageIndex)}
                data-translation-page
                data-page-index={page.pageIndex}
                className={translationPageClassName(page.pageIndex, virtualPageCount)}
                onPointerDown={handlePointerDown}
                onPointerUp={(event) => handlePointerUp(event, page)}
                style={{ top: virtualPage.offsetTop }}
              >
                <SparkMarginDots
                  pageIndex={page.pageIndex}
                  pageText={page.text}
                  pageSelector="[data-translation-page]"
                  items={sparkItems}
                  onOpen={onOpenSparkItem}
                />
                <section
                  ref={getTranslationPaneRef(page.pageIndex, "source")}
                  data-translation-pane="source"
                  data-page-index={page.pageIndex}
                  className="contents"
                >
                  {alignedRows.map((row) => (
                    <div
                      key={`source-${row.index}`}
                      data-translation-block-pane="source"
                      data-translation-block-row={row.index}
                      className={translationCellClass("source", row.index)}
                      style={{ gridColumn: 1, gridRow: row.index + 1 }}
                    >
                      {row.sourceMarkdown ? (
                        <MarkdownContent
                          content={row.sourceMarkdown}
                          allowRawHtml
                          highlightSourceText={page.text}
                          highlights={sourceHighlights}
                          headingAnchor={headingAnchor}
                          className="max-w-none text-[14px] leading-7"
                        />
                      ) : null}
                    </div>
                  ))}
                </section>
                <section
                  ref={getTranslationPaneRef(page.pageIndex, "translation")}
                  data-translation-pane="translation"
                  data-page-index={page.pageIndex}
                  className="contents"
                >
                  {alignedRows.map((row) => (
                    <div
                      key={`translation-${row.index}`}
                      data-translation-block-pane="translation"
                      data-translation-block-row={row.index}
                      className={translationCellClass("translation", row.index)}
                      style={{ gridColumn: 2, gridRow: row.index + 1 }}
                    >
                      {translatedPage?.status === "done" && row.translatedMarkdown ? (
                        <MarkdownContent
                          content={row.translatedMarkdown}
                          allowRawHtml
                          headingAnchor={headingAnchor}
                          className="max-w-none text-[14px] leading-7"
                        />
                      ) : translatedPage?.status === "failed" && row.index === 0 ? (
                        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm leading-6 text-danger-foreground">
                          {translatedPage.error || "这段内容翻译失败"}
                        </div>
                      ) : translatedPage?.status === "translating" && row.index === 0 ? (
                        <TranslationSkeleton label="正在翻译当前片段" />
                      ) : !translatedPage?.status && row.index === 0 ? (
                        <TranslationSkeleton label="等待整本翻译任务生成译文" />
                      ) : null}
                    </div>
                  ))}
                </section>
                <SelectionToolbarHost
                  present={shouldShowToolbarForPage}
                  className="absolute z-20 max-w-[calc(100%-2rem)] animate-pop-in"
                  disabled={!selectionText.trim()}
                  suppressed={toolbarSuppressed}
                  style={
                    toolbarPosition
                      ? { left: toolbarPosition.left, top: toolbarPosition.top }
                      : { left: 28, top: 80 }
                  }
                  onSizeChange={handleToolbarSizeChange}
                  onExplain={onExplain}
                  onHighlight={onHighlight}
                  onPlainExplain={onPlainExplain}
                />
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const TranslationPagePlaceholder = forwardRef<
  HTMLElement,
  { pageIndex: number; totalPages: number; top: number; minHeight: number }
>(function TranslationPagePlaceholder({ pageIndex, totalPages, top, minHeight }, ref) {
  return (
    <article
      ref={ref}
      data-translation-page
      data-translation-page-placeholder
      data-page-index={pageIndex}
      className={translationPageClassName(pageIndex, totalPages)}
      style={{ top, minHeight }}
    >
      <section className="contents">
        <div className="min-w-0 border-r px-7 py-4" style={{ gridColumn: 1, gridRow: 1 }}>
          <div className="space-y-3">
            <div className="h-4 w-11/12 rounded bg-muted reader-shimmer" />
            <div className="h-4 w-9/12 rounded bg-muted reader-shimmer" />
            <div className="h-4 w-10/12 rounded bg-muted reader-shimmer" />
          </div>
        </div>
      </section>
      <section className="contents">
        <div className="min-w-0 px-7 py-4" style={{ gridColumn: 2, gridRow: 1 }}>
          <TranslationSkeleton label="等待整本翻译任务生成译文" />
        </div>
      </section>
    </article>
  )
})

function translationPaneKey(pageIndex: number, kind: "source" | "translation") {
  return `${pageIndex}:${kind}`
}

function translationSourceHighlights({
  pageIndex,
  sparkItems,
  selectionText,
  selectionAnchor,
  shouldShowToolbarForPage,
}: {
  pageIndex: number
  sparkItems: SavedInterpretation[]
  selectionText: string
  selectionAnchor: TextSelectionAnchor | null
  shouldShowToolbarForPage: boolean
}): SavedHighlight[] {
  return [
    ...sparkItems
      .filter((item) => sparkItemBelongsToPage(item, pageIndex))
      .map((item) => sparkItemHighlight(item, pageIndex)),
    ...(shouldShowToolbarForPage
      ? [
          {
            id: "current-text-selection",
            bookId: "",
            selectionText,
            prefix: "",
            suffix: "",
            pageIndex,
            positionStart:
              selectionAnchor?.pageIndex === pageIndex ? selectionAnchor.positionStart : null,
            positionEnd:
              selectionAnchor?.pageIndex === pageIndex ? selectionAnchor.positionEnd : null,
            rects: [],
            interpretation: null,
            createdAt: "",
          } satisfies SavedHighlight,
        ]
      : []),
  ]
}

function selectionPaneForPageSelection(
  selection: Selection | null | undefined,
  pageIndex: number,
  paneRefs: Map<string, HTMLElement>,
) {
  const anchorNode = selection?.anchorNode
  if (!anchorNode) {
    return null
  }
  const anchorElement =
    anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement
  const pane = anchorElement?.closest<HTMLElement>("[data-translation-pane]")
  if (pane?.dataset.pageIndex === String(pageIndex)) {
    return pane
  }
  return (
    paneRefs.get(translationPaneKey(pageIndex, "source")) ??
    paneRefs.get(translationPaneKey(pageIndex, "translation")) ??
    null
  )
}

function isTranslationComplete(translation: TranslationStatus | null) {
  return Boolean(
    translation &&
      translation.totalPages > 0 &&
      translation.completedPages >= translation.totalPages &&
      translation.failedPages === 0 &&
      !translation.running,
  )
}

function translationStatusSummary(translation: TranslationStatus | null) {
  if (!translation) {
    return "尚未生成整本中文译文"
  }
  const providerModel = [translation.provider || "provider 未配置", translation.model]
    .filter(Boolean)
    .join(" ")
  const failed = translation.failedPages > 0 ? ` · ${translation.failedPages} 个片段失败` : ""
  const cacheState =
    isTranslationComplete(translation)
      ? " · 本地缓存"
      : translation.completedPages > 0
        ? " · 已缓存部分译文"
        : ""
  return `译文进度 ${translation.completedPages}/${translation.totalPages}${failed} · ${providerModel}${cacheState}`
}

function TranslationSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {label}
      </div>
      <div className="h-4 w-11/12 rounded bg-muted" />
      <div className="h-4 w-10/12 rounded bg-muted" />
      <div className="h-4 w-8/12 rounded bg-muted" />
      <div className="mt-5 h-20 rounded bg-muted/70" />
    </div>
  )
}

function translationSourceMarkdown(page: ParsedPage) {
  const markdown = page.markdown?.trim() || cleanPdfLineBreaks(page.text)
  return markdown
    .replace(/^#{1,6}\s*Page\s+\d+\s*\n+/i, "")
    .trim()
}

function translationCellClass(kind: "source" | "translation", rowIndex: number) {
  const borderTop = rowIndex === 0 ? "" : " border-t"
  const sideBorder = kind === "source" ? " border-r" : ""
  return `min-w-0 px-7 py-4${borderTop}${sideBorder}`
}

function shouldIgnoreSelectionClearTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false
  }
  return Boolean(
    target.closest(
      [
        "[data-testid='selection-toolbar']",
        "[data-translation-toolbar]",
        "button",
        "a",
        "input",
        "textarea",
        "select",
        "[role='button']",
      ].join(","),
    ),
  )
}

function isInsideTranslationPage(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false
  }
  return Boolean(target.closest("[data-translation-page]"))
}

function findOutlineAnchor(root: ParentNode, entryId: string) {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-outline-anchor-id]")).find(
    (element) => element.dataset.outlineAnchorId === entryId,
  )
}
