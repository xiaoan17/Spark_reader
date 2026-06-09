import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import { MarkdownContent } from "@/components/markdown/MarkdownContent"
import type { NormalizedPageRect } from "@/core/coordinates"
import { normalizeWhitespace, resolveTextQuoteSelector } from "@/core/text-quote-selector"
import type {
  ParsedChunk,
  ParsedPage,
  SavedHighlight,
  SavedInterpretation,
  TextQuality,
  TextSelectionAnchor,
} from "@/stores/reader-store"
import { shouldRenderCurrentTextSelection } from "./current-selection"
import {
  selectedTextFromRanges,
  selectionRangesWithin,
  selectionToolbarPositionFromRanges,
} from "./dom-selection"
import { SelectionToolbarHost } from "./SelectionToolbarHost"
import { SparkMarginDots, sparkItemBelongsToPage, sparkItemHighlight } from "./SparkMarginDots"
import { rawOffsetForNormalizedOffset, textSelectionAnchorFromDom } from "./text-selection-anchor"
import {
  buildVirtualPageMetrics,
  virtualPageIndexAtOffset,
  virtualPageItems,
} from "./virtual-pages"
import { readablePageClassName } from "./readable-page-class"
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

export type ConvertedTextReaderProps = {
  pages: ParsedPage[]
  chunksByPage: Map<number, ParsedChunk[]>
  activeChunkId: string
  outlineTarget?: ConvertedTextOutlineTarget | null
  currentPage: number
  totalPages: number
  approximateSelection: boolean
  highlights: SavedHighlight[]
  sparkItems?: SavedInterpretation[]
  selectionText: string
  selectionRects: NormalizedPageRect[]
  selectionAnchor: TextSelectionAnchor | null
  quality?: TextQuality | null
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
  onCurrentPageChange: (page: number) => void
  onPageWindowRequest?: (startPage: number, pageCount: number) => void
}

export type ConvertedTextOutlineTarget = {
  requestId: string
  entryId: string
  pageIndex: number
  anchorText?: string
}

export function ConvertedTextReader({
  pages,
  chunksByPage,
  activeChunkId,
  outlineTarget = null,
  currentPage,
  totalPages,
  approximateSelection,
  highlights,
  sparkItems = [],
  selectionText,
  selectionRects,
  selectionAnchor,
  quality,
  onExplain,
  onPlainExplain,
  onComment,
  onOpenSparkItem,
  onHighlight,
  onTextSelection,
  onClearSelection,
  onCurrentPageChange,
  onPageWindowRequest,
}: ConvertedTextReaderProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const textRefs = useRef(new Map<number, HTMLDivElement>())
  const toolbarSelectionRef = useRef<{ ranges: Range[]; articleElement: HTMLElement | null } | null>(null)
  const currentPageRef = useRef(currentPage)
  const observedPageChangeRef = useRef<number | null>(null)
  const programmaticScrollRef = useRef<ProgrammaticPageScroll | null>(null)
  const handledActiveChunkIdRef = useRef("")
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
        overscan: 1600,
      }),
    [virtualMetrics, virtualScroll],
  )

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
    const scroller = scrollerRef.current
    if (!scroller || totalPages <= 0) {
      return
    }
    if (consumeVisiblePageUpdateFromReaderScroll(observedPageChangeRef, currentPage)) {
      return
    }
    const target = pageRefs.current.get(currentPage - 1)
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
    // Mounted page heights settle as markdown/assets render and should not pull natural scrolling back.
  }, [currentPage, totalPages])

  useEffect(() => {
    if (!activeChunkId) {
      handledActiveChunkIdRef.current = ""
      return
    }
    if (handledActiveChunkIdRef.current === activeChunkId) {
      return
    }
    const scroller = scrollerRef.current
    if (!scroller) {
      return
    }
    const frame = requestReaderAnimationFrame(() => {
      const target = scroller.querySelector<HTMLElement>("[data-highlight-id='active-citation-target']")
      if (target) {
        scrollElementIntoScrollerView(scroller, target, { behavior: "auto", topOffset: 80 })
        handledActiveChunkIdRef.current = activeChunkId
      }
    })
    return () => cancelReaderAnimationFrame(frame)
  }, [activeChunkId, renderedPages])

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
  }, [pages, resetMeasuredPageHeights])

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
      const textElement = textRefs.current.get(page.pageIndex)
      const ranges = selectionRangesWithin(selection, textElement)
      const text = selectedTextFromRanges(ranges)
      if (selection && text) {
        const articleElement = pageRefs.current.get(page.pageIndex) ?? null
        onTextSelection(
          text,
          page.pageIndex + 1,
          textElement ? textSelectionAnchorFromReadableDom(selection, page, textElement) : null,
        )
        toolbarSelectionRef.current = { ranges, articleElement }
        setToolbarPosition(selectionToolbarPositionFromRanges(ranges, articleElement, toolbarSize))
        setToolbarSuppressed(false)
        return
      }
      clearReadableSelection()
    }, 0)
  }

  function handleBackgroundPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (isInsideReadablePage(event.target)) {
      return
    }
    handlePointerDown(event)
  }

  function handleBackgroundPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (shouldIgnoreSelectionClearTarget(event.target) || isInsideReadablePage(event.target)) {
      return
    }
    window.setTimeout(() => {
      if (!window.getSelection()?.toString().trim()) {
        clearReadableSelection()
      }
    }, 0)
  }

  return (
    <div
      ref={scrollerRef}
      className="h-full overflow-y-auto px-8 py-8"
      onPointerDown={handleBackgroundPointerDown}
      onPointerUp={handleBackgroundPointerUp}
    >
      <div
        className="relative mx-auto max-w-3xl bg-card"
        style={{ height: virtualMetrics.totalHeight }}
      >
        {renderedPages.map((virtualPage) => {
          const page = pagesByIndex.get(virtualPage.index)
          if (!page || page.loaded === false) {
            return (
              <ReadablePagePlaceholder
                key={`placeholder-${virtualPage.index}`}
                pageIndex={virtualPage.index}
                totalPages={virtualPageCount}
                top={virtualPage.offsetTop}
                minHeight={virtualPage.height}
                ref={getPageMeasurementRef(virtualPage.index)}
              />
            )
          }
          const chunks = chunksByPage.get(page.pageIndex) ?? []
          const activeChunk = chunks.find((chunk) => chunk.chunkId === activeChunkId)
          const shouldShowToolbarForPage = shouldRenderCurrentTextSelection(
            page.pageIndex,
            currentPage,
            selectionText,
            selectionAnchor,
            selectionRects,
          )
          return (
            <article
              key={page.pageIndex}
              ref={getPageMeasurementRef(page.pageIndex)}
              data-readable-page
              data-page-index={page.pageIndex}
              className={readablePageClassName(page.pageIndex, virtualPageCount)}
              onPointerDown={handlePointerDown}
              onPointerUp={(event) => handlePointerUp(event, page)}
              style={{ top: virtualPage.offsetTop }}
            >
              <div
                ref={(element) => {
                  if (element) {
                    textRefs.current.set(page.pageIndex, element)
                  } else {
                    textRefs.current.delete(page.pageIndex)
                  }
                }}
                data-spark-text-root
                data-source-text={page.text}
                className="relative font-ui text-[15px] leading-8 text-foreground"
              >
                <SparkMarginDots
                  pageIndex={page.pageIndex}
                  pageText={page.text}
                  pageSelector="[data-readable-page]"
                  items={sparkItems}
                  onOpen={onOpenSparkItem}
                />
                <ReadablePageContent
                  page={page}
                  quality={quality}
                  outlineTarget={
                    outlineTarget?.pageIndex === page.pageIndex ? outlineTarget : null
                  }
                  highlights={[
                    ...(activeChunk
                      ? [
                          {
                            id: "active-citation-target",
                            bookId: "",
                            selectionText: activeChunk.text,
                            prefix: "",
                            suffix: "",
                            pageIndex: page.pageIndex,
                            positionStart: null,
                            positionEnd: null,
                            rects: [],
                            interpretation: null,
                            createdAt: "",
                          } satisfies SavedHighlight,
                        ]
                      : []),
                    ...highlights.filter(
                      (highlight) =>
                        highlight.rects.length === 0 && highlight.pageIndex === page.pageIndex,
                    ),
                    ...sparkItems
                      .filter((item) => sparkItemBelongsToPage(item, page.pageIndex))
                      .map((item) => sparkItemHighlight(item, page.pageIndex)),
                    ...(shouldShowToolbarForPage
                      ? [
                          {
                            id: "current-text-selection",
                            bookId: "",
                            selectionText,
                            prefix: "",
                            suffix: "",
                            pageIndex: page.pageIndex,
                            positionStart:
                              selectionAnchor?.pageIndex === page.pageIndex
                                ? selectionAnchor.positionStart
                                : null,
                            positionEnd:
                              selectionAnchor?.pageIndex === page.pageIndex
                                ? selectionAnchor.positionEnd
                                : null,
                            rects: [],
                            interpretation: null,
                            createdAt: "",
                          } satisfies SavedHighlight,
                        ]
                      : []),
                  ]}
                />
              </div>
              <SelectionToolbarHost
                present={shouldShowToolbarForPage}
                approximate={approximateSelection}
                className="absolute z-20 max-w-[calc(100%-2rem)]"
                disabled={!selectionText.trim()}
                suppressed={toolbarSuppressed}
                style={
                  toolbarPosition
                    ? { left: toolbarPosition.left, top: toolbarPosition.top }
                    : { left: 40, top: 96 }
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
  )
}

const ReadablePagePlaceholder = forwardRef<
  HTMLElement,
  { pageIndex: number; totalPages: number; top: number; minHeight: number }
>(function ReadablePagePlaceholder({ pageIndex, totalPages, top, minHeight }, ref) {
  return (
    <article
      ref={ref}
      data-readable-page
      data-readable-page-placeholder
      data-page-index={pageIndex}
      className={readablePageClassName(pageIndex, totalPages, "py-4")}
      style={{ top, minHeight }}
    >
      <div className="space-y-3">
        <div className="h-4 w-11/12 rounded bg-muted reader-shimmer" />
        <div className="h-4 w-9/12 rounded bg-muted reader-shimmer" />
        <div className="h-4 w-10/12 rounded bg-muted reader-shimmer" />
        <div className="h-4 w-7/12 rounded bg-muted reader-shimmer" />
      </div>
    </article>
  )
})

function renderReadableTextWithHighlights(text: string, highlights: SavedHighlight[]) {
  const cleaned = cleanPdfLineBreaks(text)
  const normalizedText = normalizeWhitespace(cleaned)
  if (!normalizedText || highlights.length === 0) {
    return cleaned
  }

  const ranges = preferCurrentReadableSelectionRanges(
    highlights
      .map((highlight) => {
        const exact = normalizeWhitespace(highlight.selectionText)
        if (!exact) return null
        const resolved = resolveTextQuoteSelector(cleaned, {
          exact,
          prefix: highlight.prefix,
          suffix: highlight.suffix,
          positionStart: highlight.positionStart ?? null,
          positionEnd: highlight.positionEnd ?? null,
        })
        const normalizedStart = resolved?.positionStart ?? normalizedText.indexOf(exact)
        if (normalizedStart < 0) return null
        const normalizedEnd = resolved?.positionEnd ?? normalizedStart + exact.length
        if (normalizedEnd <= normalizedStart) return null
        const start = rawOffsetForNormalizedOffset(cleaned, normalizedStart)
        const end = rawOffsetForNormalizedOffset(cleaned, normalizedEnd)
        if (end <= start) return null
        return {
          id: highlight.id,
          start,
          end: Math.min(end, cleaned.length),
        }
      })
      .filter((range): range is ReadableHighlightRange => range !== null),
  ).sort((left, right) => left.start - right.start || right.end - left.end)

  if (ranges.length === 0) {
    return text
  }

  const nodes: ReactNode[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start < cursor) continue
    if (range.start > cursor) {
      nodes.push(cleaned.slice(cursor, range.start))
    }
    nodes.push(
      <mark
        key={range.id}
        className={readableHighlightClassName(range.id)}
        data-highlight-id={range.id}
        data-highlight-type={readableHighlightType(range.id)}
        data-current-selection={range.id === "current-text-selection" ? "true" : undefined}
      >
        {cleaned.slice(range.start, range.end)}
      </mark>,
    )
    cursor = range.end
  }
  if (cursor < cleaned.length) {
    nodes.push(cleaned.slice(cursor))
  }
  return nodes.length > 0 ? nodes : cleaned
}

function ReadablePageContent({
  page,
  quality,
  outlineTarget,
  highlights,
}: {
  page: ParsedPage
  quality?: TextQuality | null
  outlineTarget?: ConvertedTextOutlineTarget | null
  highlights: SavedHighlight[]
}) {
  const markdown = stripGeneratedPageHeading(page.markdown?.trim() ?? "")
  if (markdown) {
    return (
      <MarkdownContent
        content={markdown}
        allowRawHtml
        highlightSourceText={page.text}
        headingAnchor={
          outlineTarget?.anchorText
            ? { id: outlineTarget.entryId, text: outlineTarget.anchorText }
            : null
        }
        highlights={highlights}
        className="max-w-none text-[15px] leading-8 [&_.markdown-highlight-source]:hidden"
      />
    )
  }
  return (
    <div className="whitespace-pre-wrap">
      {renderReadableTextWithHighlights(
        page.text ||
          (quality?.looksUsable === false
            ? "这段转换稿质量偏低，可能需要回到 PDF 校对。"
            : "这里没有抽取到可用文字。"),
        highlights,
      )}
    </div>
  )
}

function stripGeneratedPageHeading(markdown: string) {
  return markdown
    .replace(/^#{1,3}\s*(?:第\s*\d+\s*页|Page\s+\d+)\s*\n+/iu, "")
    .trim()
}

function readableHighlightClassName(id: string) {
  if (id === "current-text-selection") {
    return "reader-current-text-selection box-decoration-clone rounded-sm bg-amber-200/80 text-foreground ring-1 ring-amber-500/35 dark:bg-amber-300/35"
  }
  if (id === "active-citation-target") {
    return "box-decoration-clone rounded-sm bg-sky-200/75 text-foreground ring-1 ring-sky-500/25 animate-citation-pulse dark:bg-sky-300/30"
  }
  if (id.startsWith("spark-anchor-")) {
    return "reader-spark-text-anchor"
  }
  return "box-decoration-clone rounded-sm bg-teal-300/35 text-foreground dark:bg-teal-300/25"
}

function readableHighlightType(id: string) {
  if (id === "current-text-selection") return "selection"
  if (id === "active-citation-target") return "citation"
  return "saved"
}

type ReadableHighlightRange = {
  id: string
  start: number
  end: number
}

function preferCurrentReadableSelectionRanges(ranges: ReadableHighlightRange[]) {
  const currentSelection = ranges.find((range) => range.id === "current-text-selection")
  if (!currentSelection) {
    return ranges
  }
  return ranges.filter(
    (range) => range.id === currentSelection.id || !readableRangesOverlap(range, currentSelection),
  )
}

function readableRangesOverlap(left: ReadableHighlightRange, right: ReadableHighlightRange) {
  return left.start < right.end && left.end > right.start
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

function isInsideReadablePage(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false
  }
  return Boolean(target.closest("[data-readable-page]"))
}

function textSelectionAnchorFromReadableDom(
  selection: Selection,
  page: ParsedPage,
  textElement: HTMLElement,
): TextSelectionAnchor | null {
  const sourceText = textElement.dataset.sourceText ?? textElement.innerText
  return textSelectionAnchorFromDom(selection, sourceText, page.pageIndex, textElement)
}

function findOutlineAnchor(root: ParentNode, entryId: string) {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-outline-anchor-id]")).find(
    (element) => element.dataset.outlineAnchorId === entryId,
  )
}
