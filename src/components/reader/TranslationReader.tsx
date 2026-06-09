import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import { Loader2 } from "lucide-react"
import { MarkdownContent } from "@/components/markdown/MarkdownContent"
import type { NormalizedPageRect } from "@/core/coordinates"
import type { TranslationStatus } from "@/core/library-api"
import { makeTextQuoteSelector, normalizeWhitespace } from "@/core/text-quote-selector"
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
  sourceBlockForTranslatedSelection,
  type AlignedTranslationRow,
} from "./translation-alignment"
import {
  buildVirtualPageMetrics,
  virtualPageIndexAtOffset,
  virtualPageItems,
} from "./virtual-pages"
import {
  translationPageClassName,
  translationSourceSurfaceClassName,
} from "./translation-page-class"
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
const TRANSLATION_RAIL_WIDTH = 326
const TRANSLATION_SOURCE_WIDTH = 768
const TRANSLATION_RAIL_GAP = 20
const TRANSLATION_WIDE_CANVAS_WIDTH =
  TRANSLATION_SOURCE_WIDTH + TRANSLATION_RAIL_GAP + TRANSLATION_RAIL_WIDTH
const TRANSLATION_WIDE_LAYOUT_MIN_WIDTH = TRANSLATION_WIDE_CANVAS_WIDTH + 32

type TranslationLayout = "inline" | "rail"

export type TranslationReaderProps = {
  pages: ParsedPage[]
  outlineTarget?: ConvertedTextOutlineTarget | null
  currentPage: number
  totalPages: number
  translation: TranslationStatus | null
  selectionText: string
  selectionRects: NormalizedPageRect[]
  selectionAnchor: TextSelectionAnchor | null
  sparkItems?: SavedInterpretation[]
  onCurrentPageChange: (page: number) => void
  onExplain: () => void
  onPlainExplain: () => void
  onComment?: () => void
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
  selectionText,
  selectionRects,
  selectionAnchor,
  sparkItems = [],
  onCurrentPageChange,
  onExplain,
  onPlainExplain,
  onComment,
  onOpenSparkItem,
  onHighlight,
  onTextSelection,
  onClearSelection,
  onPageWindowRequest,
}: TranslationReaderProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const paneRefs = useRef(new Map<string, HTMLElement>())
  const sourceBlockRefs = useRef(new Map<string, HTMLElement>())
  const sourceBlockRefCallbacksRef = useRef(new Map<string, (element: HTMLElement | null) => void>())
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
  const [translationLayout, setTranslationLayout] = useState<TranslationLayout>("inline")
  const [sourceBlockMeasurements, setSourceBlockMeasurements] = useState(new Map<string, SourceBlockMeasurement>())
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
    const scroller = scrollerRef.current
    if (!scroller) {
      return
    }
    const syncLayout = () => {
      const width = scroller.clientWidth || scroller.getBoundingClientRect().width || 0
      const nextLayout: TranslationLayout =
        width >= TRANSLATION_WIDE_LAYOUT_MIN_WIDTH ? "rail" : "inline"
      setTranslationLayout((current) => (current === nextLayout ? current : nextLayout))
    }
    syncLayout()
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncLayout)
      return () => window.removeEventListener("resize", syncLayout)
    }
    const observer = new ResizeObserver(syncLayout)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    resetMeasuredPageHeights({ preserveExisting: true })
  }, [pages, translation, translationLayout, resetMeasuredPageHeights])

  useLayoutEffect(() => {
    if (sourceBlockRefs.current.size === 0) {
      setSourceBlockMeasurements(new Map())
      return
    }

    let frame = 0
    const measure = () => {
      frame = 0
      const next = new Map<string, SourceBlockMeasurement>()
      for (const [key, element] of sourceBlockRefs.current) {
        const page = element.closest<HTMLElement>("[data-translation-page]")
        if (!page) {
          continue
        }
        const elementRect = element.getBoundingClientRect()
        const pageRect = page.getBoundingClientRect()
        const top = elementRect.top - pageRect.top
        const height = Math.max(40, elementRect.height)
        if (Number.isFinite(top) && Number.isFinite(height)) {
          next.set(key, { top, height })
        }
      }
      setSourceBlockMeasurements((current) =>
        sourceBlockMeasurementMapsEqual(current, next) ? current : next,
      )
    }
    const scheduleMeasure = () => {
      if (frame !== 0) {
        return
      }
      frame = requestReaderAnimationFrame(measure)
    }

    scheduleMeasure()
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", scheduleMeasure)
      return () => {
        window.removeEventListener("resize", scheduleMeasure)
        cancelReaderAnimationFrame(frame)
      }
    }

    const observer = new ResizeObserver(scheduleMeasure)
    for (const element of sourceBlockRefs.current.values()) {
      observer.observe(element)
    }
    return () => {
      observer.disconnect()
      cancelReaderAnimationFrame(frame)
    }
  }, [renderedPages, translation])

  function clearTranslationPageRefs(pageIndex: number, element: HTMLElement | null) {
    if (!element) {
      paneRefs.current.delete(translationPaneKey(pageIndex, "source"))
      paneRefs.current.delete(translationPaneKey(pageIndex, "translation"))
      for (const key of sourceBlockRefs.current.keys()) {
        if (key.startsWith(`${pageIndex}:`)) {
          sourceBlockRefs.current.delete(key)
        }
      }
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
    const callback = (element: HTMLElement | null) => {
      if (element) {
        paneRefs.current.set(key, element)
      } else {
        paneRefs.current.delete(key)
      }
    }
    return callback
  }

  function getSourceBlockRef(pageIndex: number, blockId: string) {
    const key = translationBlockKey(pageIndex, blockId)
    const existing = sourceBlockRefCallbacksRef.current.get(key)
    if (existing) {
      return existing
    }
    const callback = (element: HTMLElement | null) => {
      if (element) {
        sourceBlockRefs.current.set(key, element)
      } else {
        sourceBlockRefs.current.delete(key)
      }
    }
    sourceBlockRefCallbacksRef.current.set(key, callback)
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
        const sourceMarkdown = translationSourceMarkdown(page)
        const translatedMarkdown = translatedMarkdownForPage(translationPages, page.pageIndex, sourceMarkdown)
        const selectionTarget = translationSelectionTarget({
          selectedText: text,
          selection,
          pane,
          page,
          sourceMarkdown,
          translatedMarkdown,
        })
        onTextSelection(selectionTarget.text, page.pageIndex + 1, selectionTarget.anchor)
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

  const useRailLayout = translationLayout === "rail"

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollerRef}
        className={`min-h-0 flex-1 overflow-y-auto py-7 ${
          useRailLayout ? "overflow-x-auto px-4" : "overflow-x-hidden px-6 md:px-8"
        }`}
        data-translation-scroller
        data-translation-layout={translationLayout}
        onPointerDown={handleBackgroundPointerDown}
        onPointerUp={handleBackgroundPointerUp}
      >
        <div
          className={`relative mx-auto ${useRailLayout ? "" : "max-w-3xl bg-card"}`}
          style={{
            height: virtualMetrics.totalHeight,
            width: useRailLayout ? TRANSLATION_WIDE_CANVAS_WIDTH : undefined,
          }}
        >
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
            const translatedMarkdown = translatedMarkdownForPage(
              translationPages,
              page.pageIndex,
              sourceMarkdown,
            )
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
                <section
                  ref={getTranslationPaneRef(page.pageIndex, "source")}
                  data-translation-pane="source"
                  data-spark-text-root
                  data-page-index={page.pageIndex}
                  data-source-text={page.text}
                  className={translationSourceSurfaceClassName(page.pageIndex, virtualPageCount)}
                >
                  <SparkMarginDots
                    pageIndex={page.pageIndex}
                    pageText={page.text}
                    pageSelector="[data-translation-page]"
                    items={sparkItems}
                    onOpen={onOpenSparkItem}
                  />
                  {useRailLayout ? (
                    <TranslationSourceContent
                      page={page}
                      rows={alignedRows}
                      highlights={sourceHighlights}
                      headingAnchor={headingAnchor}
                      getSourceBlockRef={getSourceBlockRef}
                    />
                  ) : (
                    <TranslationInlineContent
                      page={page}
                      rows={alignedRows}
                      translatedPage={translatedPage}
                      highlights={sourceHighlights}
                      headingAnchor={headingAnchor}
                      getSourceBlockRef={getSourceBlockRef}
                    />
                  )}
                </section>
                {useRailLayout ? (
                  <section
                    ref={getTranslationPaneRef(page.pageIndex, "translation")}
                    data-translation-pane="translation"
                    data-page-index={page.pageIndex}
                    className="absolute top-0"
                    style={{
                      left: TRANSLATION_SOURCE_WIDTH + TRANSLATION_RAIL_GAP,
                      width: TRANSLATION_RAIL_WIDTH,
                    }}
                  >
                    <TranslationRail
                      pageIndex={page.pageIndex}
                      rows={alignedRows}
                      translatedPage={translatedPage}
                      sourceBlockMeasurements={sourceBlockMeasurements}
                    />
                  </section>
                ) : null}
                <SelectionToolbarHost
                  present={shouldShowToolbarForPage}
                  className="absolute z-20 max-w-[calc(100%-2rem)]"
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
                  onComment={onComment}
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
      <section className={translationSourceSurfaceClassName(pageIndex, totalPages)}>
        <div className="space-y-3">
          <div className="h-4 w-11/12 rounded bg-muted reader-shimmer" />
          <div className="h-4 w-9/12 rounded bg-muted reader-shimmer" />
          <div className="h-4 w-10/12 rounded bg-muted reader-shimmer" />
        </div>
      </section>
    </article>
  )
})

function translationPaneKey(pageIndex: number, kind: "source" | "translation") {
  return `${pageIndex}:${kind}`
}

function translationBlockKey(pageIndex: number, blockId: string) {
  return `${pageIndex}:${blockId}`
}

type SourceBlockMeasurement = {
  top: number
  height: number
}

function TranslationSourceContent({
  page,
  rows,
  highlights,
  headingAnchor,
  getSourceBlockRef,
}: {
  page: ParsedPage
  rows: AlignedTranslationRow[]
  highlights: SavedHighlight[]
  headingAnchor: { id: string; text: string } | null
  getSourceBlockRef: (pageIndex: number, blockId: string) => (element: HTMLElement | null) => void
}) {
  const blocks = rows.filter((row) => row.sourceMarkdown.trim())
  if (blocks.length === 0) {
    return (
      <div className="font-ui text-[15px] leading-8 text-muted-foreground">
        这里没有抽取到可用文字。
      </div>
    )
  }
  return (
    <div className="relative font-ui text-[15px] leading-8 text-foreground">
      {blocks.map((row) => (
        <div
          key={row.id}
          ref={getSourceBlockRef(page.pageIndex, row.id)}
          data-translation-block-pane="source"
          data-translation-block-id={row.id}
          data-translation-block-row={row.index}
        >
          <MarkdownContent
            content={row.sourceMarkdown}
            allowRawHtml
            highlightSourceText={page.text}
            highlights={highlights}
            headingAnchor={headingAnchor}
            className="max-w-none text-[15px] leading-8"
          />
        </div>
      ))}
    </div>
  )
}

function TranslationInlineContent({
  page,
  rows,
  translatedPage,
  highlights,
  headingAnchor,
  getSourceBlockRef,
}: {
  page: ParsedPage
  rows: AlignedTranslationRow[]
  translatedPage?: TranslationStatus["pages"][number]
  highlights: SavedHighlight[]
  headingAnchor: { id: string; text: string } | null
  getSourceBlockRef: (pageIndex: number, blockId: string) => (element: HTMLElement | null) => void
}) {
  const blocks = rows.filter((row) => row.sourceMarkdown.trim() || row.translatedMarkdown.trim())
  if (blocks.length === 0) {
    return (
      <div className="font-ui text-[15px] leading-8 text-muted-foreground">
        这里没有抽取到可用文字。
      </div>
    )
  }

  const notice = inlineTranslationNotice(translatedPage)

  return (
    <div className="relative font-ui text-[15px] leading-8 text-foreground">
      {notice ? <div className="mb-5">{notice}</div> : null}
      {blocks.map((row) => {
        const hasSource = row.sourceMarkdown.trim().length > 0
        const hasTranslation = row.translatedMarkdown.trim().length > 0
        return (
          <div key={row.id} className="translation-inline-row">
            {hasSource ? (
              <div
                ref={getSourceBlockRef(page.pageIndex, row.id)}
                data-translation-block-pane="source"
                data-translation-block-id={row.id}
                data-translation-block-row={row.index}
              >
                <MarkdownContent
                  content={row.sourceMarkdown}
                  allowRawHtml
                  highlightSourceText={page.text}
                  highlights={highlights}
                  headingAnchor={headingAnchor}
                  className="max-w-none text-[15px] leading-8"
                />
              </div>
            ) : null}
            {hasTranslation ? (
              <div
                data-translation-pane="translation"
                data-page-index={page.pageIndex}
                data-translation-block-pane="translation"
                data-translation-block-id={row.id}
                data-translation-block-row={row.index}
                className="mb-5 mt-2 border-l-2 border-primary/35 bg-muted/45 px-4 py-2 text-foreground/90"
              >
                <MarkdownContent
                  content={row.translatedMarkdown}
                  allowRawHtml
                  className="max-w-none text-[14px] leading-7"
                />
              </div>
            ) : (
              <div
                aria-hidden="true"
                data-translation-pane="translation"
                data-page-index={page.pageIndex}
                data-translation-block-pane="translation"
                data-translation-block-id={row.id}
                data-translation-block-row={row.index}
                className="hidden"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function inlineTranslationNotice(translatedPage?: TranslationStatus["pages"][number]) {
  if (translatedPage?.status === "failed") {
    return (
      <div className="border-l-2 border-danger/50 bg-danger/10 px-4 py-2 text-sm leading-6 text-danger-foreground">
        {translatedPage.error || "这段内容翻译失败"}
      </div>
    )
  }
  if (translatedPage?.status === "translating") {
    return (
      <div className="border-l-2 border-primary/35 bg-muted/45 px-4 py-2">
        <TranslationSkeleton label="正在翻译当前片段" />
      </div>
    )
  }
  if (!translatedPage?.status) {
    return (
      <div className="border-l-2 border-border bg-muted/35 px-4 py-2">
        <TranslationSkeleton label="等待整本翻译任务生成译文" />
      </div>
    )
  }
  return null
}

function TranslationRail({
  pageIndex,
  rows,
  translatedPage,
  sourceBlockMeasurements,
}: {
  pageIndex: number
  rows: AlignedTranslationRow[]
  translatedPage?: TranslationStatus["pages"][number]
  sourceBlockMeasurements: Map<string, SourceBlockMeasurement>
}) {
  if (translatedPage?.status === "failed") {
    return (
      <TranslationRailNotice top={40}>
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm leading-6 text-danger-foreground">
          {translatedPage.error || "这段内容翻译失败"}
        </div>
      </TranslationRailNotice>
    )
  }
  if (translatedPage?.status === "translating") {
    return (
      <TranslationRailNotice top={40}>
        <TranslationSkeleton label="正在翻译当前片段" />
      </TranslationRailNotice>
    )
  }
  if (!translatedPage?.status) {
    return (
      <TranslationRailNotice top={40}>
        <TranslationSkeleton label="等待整本翻译任务生成译文" />
      </TranslationRailNotice>
    )
  }

  return (
    <>
      {rows
        .filter((row) => row.sourceMarkdown.trim() || row.translatedMarkdown.trim())
        .map((row) => {
          const measurement = sourceBlockMeasurements.get(translationBlockKey(pageIndex, row.id))
          const top = measurement?.top ?? 40 + row.index * 140
          const sourceHeight = measurement?.height ?? 96
          const maxHeight = Math.max(96, Math.min(260, sourceHeight + 96))
          const hasTranslation = row.translatedMarkdown.trim().length > 0
          return (
            <div
              key={row.id}
              data-translation-block-pane="translation"
              data-translation-block-id={row.id}
              data-translation-block-row={row.index}
              className={`absolute left-0 right-0 px-3 py-2 ${
                hasTranslation ? "border-l-2 border-primary/35 bg-card/90" : "pointer-events-none"
              }`}
              style={{ top, maxHeight, overflowY: "auto" }}
            >
              {hasTranslation ? (
                <MarkdownContent
                  content={row.translatedMarkdown}
                  allowRawHtml
                  className="max-w-none text-[14px] leading-7"
                />
              ) : null}
            </div>
          )
        })}
    </>
  )
}

function TranslationRailNotice({
  top,
  children,
}: {
  top: number
  children: ReactNode
}) {
  return (
    <div className="absolute left-0 right-0 rounded-md border bg-card/95 px-3 py-2 shadow-sm" style={{ top }}>
      {children}
    </div>
  )
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

function translatedMarkdownForPage(
  translationPages: Map<number, TranslationStatus["pages"][number]>,
  pageIndex: number,
  sourceMarkdown: string,
) {
  const translatedPage = translationPages.get(pageIndex)
  return translatedPage?.status === "done"
    ? sanitizeDisplayedTranslationMarkdown(translatedPage.translatedMarkdown, sourceMarkdown)
    : ""
}

function translationSelectionTarget({
  selectedText,
  selection,
  pane,
  page,
  sourceMarkdown,
  translatedMarkdown,
}: {
  selectedText: string
  selection: Selection
  pane: HTMLElement | null
  page: ParsedPage
  sourceMarkdown: string
  translatedMarkdown: string
}): { text: string; anchor: TextSelectionAnchor | null } {
  if (pane?.dataset.translationPane === "translation") {
    const selectedBlockId = translationBlockIdForSelection(selection)
    const rows = alignedTranslationRows(sourceMarkdown, translatedMarkdown)
    const sourceRow =
      (selectedBlockId
        ? rows.find((row) => row.id === selectedBlockId && row.sourceMarkdown.trim())
        : null) ??
      sourceBlockForTranslatedSelection(sourceMarkdown, translatedMarkdown, selectedText)
    if (sourceRow?.sourceMarkdown.trim()) {
      const text = normalizeWhitespace(markdownToSelectionText(sourceRow.sourceMarkdown))
      return {
        text,
        anchor: sourceBlockAnchor(page, text),
      }
    }
  }

  return {
    text: selectedText,
    anchor: pane
      ? textSelectionAnchorFromDomSelection(selection, pane.textContent ?? "", page.pageIndex, pane)
      : null,
  }
}

function translationBlockIdForSelection(selection: Selection) {
  const anchorElement =
    selection.anchorNode instanceof HTMLElement
      ? selection.anchorNode
      : selection.anchorNode?.parentElement
  const focusElement =
    selection.focusNode instanceof HTMLElement
      ? selection.focusNode
      : selection.focusNode?.parentElement
  const anchorBlock = anchorElement?.closest<HTMLElement>("[data-translation-block-id]")
  const focusBlock = focusElement?.closest<HTMLElement>("[data-translation-block-id]")
  if (
    anchorBlock?.dataset.translationBlockId &&
    anchorBlock.dataset.translationBlockId === focusBlock?.dataset.translationBlockId
  ) {
    return anchorBlock.dataset.translationBlockId
  }
  return anchorBlock?.dataset.translationBlockId ?? null
}

function sourceBlockAnchor(page: ParsedPage, sourceBlockText: string): TextSelectionAnchor | null {
  const selector = makeTextQuoteSelector(page.text, sourceBlockText)
  if (selector.positionStart === null || selector.positionEnd === null) {
    return null
  }
  return {
    pageIndex: page.pageIndex,
    positionStart: selector.positionStart,
    positionEnd: selector.positionEnd,
  }
}

function markdownToSelectionText(markdown: string) {
  return markdown
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[#>*_~|[\]()`-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
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

function shouldIgnoreSelectionClearTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false
  }
  return Boolean(
    target.closest(
      [
        "[data-testid='selection-toolbar']",
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

function sourceBlockMeasurementMapsEqual(
  left: Map<string, SourceBlockMeasurement>,
  right: Map<string, SourceBlockMeasurement>,
) {
  if (left.size !== right.size) {
    return false
  }
  for (const [key, value] of left) {
    const other = right.get(key)
    if (!other || other.top !== value.top || other.height !== value.height) {
      return false
    }
  }
  return true
}
