import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react"
import {
  loadPdfJs,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "@/pdf/pdfjs-compat"
import type { NormalizedPageRect } from "@/core/coordinates"
import {
  type ClientRectLike,
  normalizedToViewportRect,
  rectToCss,
  viewportRectToNormalized,
} from "@/core/coordinates"
import { SelectionToolbar } from "@/components/selection/SelectionToolbar"
import type { TextSelectionAnchor } from "@/stores/reader-store"
import { textSelectionAnchorFromDom } from "./text-selection-anchor"
import {
  buildVirtualPageMetrics,
  virtualPageIndexAtOffset,
  virtualPageItems,
  virtualPageOffset,
} from "./virtual-pages"
import { useVirtualPageMeasurements } from "./use-virtual-page-measurements"

type PdfCanvasPageProps = {
  pdf: PDFDocumentProxy
  pageNumber: number
  zoom: number
  pageText: string
  highlightRects?: NormalizedPageRect[]
  selectionRects: NormalizedPageRect[]
  approximateSelection?: boolean
  onSelection: (
    text: string,
    rects: NormalizedPageRect[],
    anchor?: TextSelectionAnchor | null,
  ) => void
  onClearSelection: () => void
  onExplain: () => void
  onPlainExplain: () => void
  onApplyInterpret?: () => void
  onSpark?: () => void
  askOpen: boolean
  question: string
  onAskToggle: () => void
  onQuestionChange: (question: string) => void
  onQuestionSubmit: () => void
  onHighlight: () => void
  onCopy: () => void
  onRenderError: (message: string) => void
}

type PdfDocumentViewerProps = Omit<PdfCanvasPageProps, "pageNumber" | "pageText"> & {
  currentPage: number
  totalPages: number
  pageTextForPage: (pageIndex: number) => string
  onCurrentPageChange: (page: number) => void
}

type PageState = {
  width: number
  height: number
}

type ProgrammaticPdfScroll = {
  page: number
  targetTop: number
  timeoutId: number
  cleanup?: () => void
}

type ProgrammaticPdfScrollRef = MutableRefObject<ProgrammaticPdfScroll | null>

export function PdfDocumentViewer({
  pdf,
  currentPage,
  totalPages,
  zoom,
  pageTextForPage,
  highlightRects = [],
  selectionRects,
  approximateSelection = false,
  onSelection,
  onClearSelection,
  onExplain,
  onPlainExplain,
  onApplyInterpret = () => undefined,
  onSpark = () => undefined,
  askOpen,
  question,
  onAskToggle,
  onQuestionChange,
  onQuestionSubmit,
  onHighlight,
  onCopy,
  onRenderError,
  onCurrentPageChange,
}: PdfDocumentViewerProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const currentPageRef = useRef(currentPage)
  const observedPageChangeRef = useRef<number | null>(null)
  const programmaticScrollRef = useRef<ProgrammaticPdfScroll | null>(null)
  const [virtualScroll, setVirtualScroll] = useState({ top: 0, height: 900 })
  const {
    pageRefs,
    measuredPageHeights,
    getPageMeasurementRef,
    resetMeasuredPageHeights,
  } = useVirtualPageMeasurements()
  const virtualMetrics = useMemo(
    () =>
      buildVirtualPageMetrics({
        count: totalPages,
        estimatedHeight: 841 * zoom,
        gap: 32,
        measuredHeights: measuredPageHeights,
      }),
    [measuredPageHeights, totalPages, zoom],
  )
  const renderedPages = useMemo(
    () =>
      virtualPageItems({
        metrics: virtualMetrics,
        scrollTop: virtualScroll.top,
        viewportHeight: virtualScroll.height,
        overscan: 1800,
      }),
    [virtualMetrics, virtualScroll],
  )

  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])

  useEffect(() => () => clearProgrammaticPdfScroll(programmaticScrollRef), [])

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
        shouldDeferVisiblePdfPageUpdateForProgrammaticScroll(
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
        observedPageChangeRef.current = bestPage
        onCurrentPageChange(bestPage)
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
  }, [onCurrentPageChange, totalPages, virtualMetrics])

  useEffect(() => {
    const target = pageRefs.current.get(currentPage - 1)
    const scroller = scrollerRef.current
    if (!scroller || totalPages <= 0) {
      return
    }
    if (observedPageChangeRef.current === currentPage) {
      observedPageChangeRef.current = null
      return
    }
    if (target && isPdfPageNearScrollerAnchor(scroller, target)) {
      return
    }
    const targetTop = target
      ? scrollPdfPageIntoScrollerView(scroller, target)
      : scrollVirtualPdfPageIntoScrollerView(scroller, virtualMetrics, currentPage - 1, {
          behavior: "smooth",
          topOffset: 24,
        })
    startProgrammaticPdfScroll(programmaticScrollRef, currentPage, targetTop, scroller)
    // Intentionally keyed to page intent, not measurement-only virtual metric updates.
    // Measured PDF page heights settle after mount and should not pull natural scrolling back.
  }, [currentPage, totalPages])

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
    resetMeasuredPageHeights()
  }, [pdf, totalPages, zoom, resetMeasuredPageHeights])

  function clearSelection() {
    window.getSelection()?.removeAllRanges()
    onClearSelection()
  }

  function handleBackgroundPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target
    if (!(target instanceof Element)) {
      return
    }
    if (target.closest("[data-pdf-page], [data-testid='selection-toolbar']")) {
      return
    }
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      clearSelection()
    }
  }

  return (
    <div
      ref={scrollerRef}
      className="h-full min-h-0 overflow-auto px-8 py-8"
      data-pdf-scroller
      onPointerUp={handleBackgroundPointerUp}
    >
      <div
        className="relative mx-auto min-w-max"
        style={{ height: virtualMetrics.totalHeight }}
      >
        {renderedPages.map((virtualPage) => {
          const pageNumber = virtualPage.index + 1
          return (
          <section
            key={pageNumber}
            ref={getPageMeasurementRef(virtualPage.index)}
            className="absolute left-1/2 scroll-mt-8"
            data-pdf-page-wrapper
            style={{
              top: virtualPage.offsetTop,
              minHeight: virtualPage.height,
              transform: "translateX(-50%)",
            }}
          >
            <PdfCanvasPage
              pdf={pdf}
              pageNumber={pageNumber}
              zoom={zoom}
              pageText={pageTextForPage(pageNumber - 1)}
              highlightRects={highlightRects}
              selectionRects={selectionRects}
              approximateSelection={approximateSelection}
              onSelection={onSelection}
              onClearSelection={clearSelection}
              onExplain={onExplain}
              onPlainExplain={onPlainExplain}
              onApplyInterpret={onApplyInterpret}
              onSpark={onSpark}
              askOpen={askOpen}
              question={question}
              onAskToggle={onAskToggle}
              onQuestionChange={onQuestionChange}
              onQuestionSubmit={onQuestionSubmit}
              onHighlight={onHighlight}
              onCopy={onCopy}
              onRenderError={onRenderError}
            />
          </section>
          )
        })}
      </div>
    </div>
  )
}

export function PdfCanvasPage({
  pdf,
  pageNumber,
  zoom,
  pageText,
  highlightRects = [],
  selectionRects,
  approximateSelection = false,
  onSelection,
  onClearSelection,
  onExplain,
  onPlainExplain,
  onApplyInterpret = () => undefined,
  onSpark = () => undefined,
  askOpen,
  question,
  onAskToggle,
  onQuestionChange,
  onQuestionSubmit,
  onHighlight,
  onCopy,
  onRenderError,
}: PdfCanvasPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pageRef = useRef<HTMLDivElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const [pageState, setPageState] = useState<PageState | null>(null)

  useEffect(() => {
    let cancelled = false
    let renderTask: RenderTask | null = null
    let textLayer: { render: () => Promise<void>; cancel: () => void } | null = null

    async function renderPage() {
      try {
        const { TextLayer } = await loadPdfJs()
        const canvas = canvasRef.current
        const textLayerContainer = textLayerRef.current
        if (!canvas || !textLayerContainer) {
          return
        }

        textLayerContainer.replaceChildren()
        const page: PDFPageProxy = await pdf.getPage(pageNumber)
        if (cancelled) {
          return
        }

        const viewport = page.getViewport({ scale: zoom })
        const outputScale = window.devicePixelRatio || 1
        const context = canvas.getContext("2d")
        if (!context) {
          throw new Error("无法创建 PDF canvas")
        }

        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`

        setPageState({ width: viewport.width, height: viewport.height })

        renderTask = page.render({
          canvas: null,
          canvasContext: context,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
        })
        await renderTask.promise
        if (cancelled) {
          return
        }

        const textContent = await page.getTextContent()
        if (cancelled) {
          return
        }

        textLayerContainer.style.setProperty("--total-scale-factor", String(zoom))
        textLayer = new TextLayer({
          textContentSource: textContent,
          container: textLayerContainer,
          viewport,
        })
        await textLayer.render()
      } catch (error) {
        if (!cancelled) {
          onRenderError(error instanceof Error ? error.message : String(error))
        }
      }
    }

    void renderPage()

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
    }
  }, [onRenderError, pageNumber, pdf, zoom])

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target
    if (target instanceof Element && target.closest("[data-testid='selection-toolbar']")) {
      return
    }
    window.setTimeout(() => {
      const selection = window.getSelection()
      const pageElement = pageRef.current
      const textLayerElement = textLayerRef.current
      if (!selection || selection.isCollapsed || !pageElement || !textLayerElement || !pageState) {
        if (!selection || selection?.isCollapsed) {
          onClearSelection()
        }
        return
      }

      const text = selection.toString().trim()
      if (!text) {
        return
      }

      const pageBox = pageElement.getBoundingClientRect()
      const rects = Array.from(selection.getRangeAt(0).getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) =>
          viewportRectToNormalized(
            pageNumber - 1,
            {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            },
            { left: pageBox.left, top: pageBox.top },
            { width: pageState.width, height: pageState.height },
          ),
        )

      if (rects.length > 0) {
        onSelection(
          text,
          rects,
          pageText
            ? textSelectionAnchorFromDom(selection, pageText, pageNumber - 1, textLayerElement)
            : null,
        )
      }
    }, 0)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target
    const textLayerElement = textLayerRef.current
    if (!(target instanceof Node) || !textLayerElement) {
      return
    }
    if (target instanceof Element && target.closest("[data-testid='selection-toolbar']")) {
      return
    }
    if (target === textLayerElement || !textLayerElement.contains(target)) {
      window.getSelection()?.removeAllRanges()
      onClearSelection()
    }
  }

  const pageIndex = pageNumber - 1
  const visibleHighlightRects = useMemo(
    () => (pageState ? viewportRectsForPage(highlightRects, pageIndex, pageState) : []),
    [highlightRects, pageIndex, pageState],
  )
  const visibleSelectionRects = useMemo(
    () => (pageState ? viewportRectsForPage(selectionRects, pageIndex, pageState) : []),
    [selectionRects, pageIndex, pageState],
  )
  const visibleRects = useMemo(
    () => [...visibleHighlightRects, ...visibleSelectionRects],
    [visibleHighlightRects, visibleSelectionRects],
  )
  const toolbarPosition =
    pageState && visibleSelectionRects.length > 0
      ? pdfSelectionToolbarPositionFromViewportRects(visibleSelectionRects, pageState)
      : null

  return (
    <div
      ref={pageRef}
      className="relative mx-auto bg-white shadow-md"
      data-pdf-page
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      style={{
        width: pageState?.width ?? 595 * zoom,
        height: pageState?.height ?? 841 * zoom,
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div ref={textLayerRef} className="textLayer absolute inset-0" />
      {pageState
        ? visibleRects.map((rect, index) => (
            <div
              key={`${pageNumber}-${index}`}
              className="pointer-events-none absolute z-[2] rounded-sm bg-teal-300/35"
              style={rectToCss(rect)}
            />
          ))
        : null}
      {visibleSelectionRects.length > 0 ? (
        <SelectionToolbar
          approximate={approximateSelection}
          askOpen={askOpen}
          className="absolute z-10 max-w-[calc(100%-2rem)] animate-pop-in"
          question={question}
          style={toolbarPosition ?? { left: 32, top: 32 }}
          onAskToggle={onAskToggle}
          onCopy={onCopy}
          onExplain={onExplain}
          onHighlight={onHighlight}
          onPlainExplain={onPlainExplain}
          onApplyInterpret={onApplyInterpret}
          onSpark={onSpark}
          onQuestionChange={onQuestionChange}
          onQuestionSubmit={onQuestionSubmit}
        />
      ) : null}
    </div>
  )
}

export function pdfSelectionToolbarPosition(
  selectionRects: NormalizedPageRect[],
  pageState: PageState,
) {
  return pdfSelectionToolbarPositionFromViewportRects(
    selectionRects.map((rect) => normalizedToViewportRect(rect, pageState)),
    pageState,
  )
}

export function viewportRectsForPage(
  rects: NormalizedPageRect[],
  pageIndex: number,
  pageState: PageState,
) {
  return rects
    .filter((rect) => rect.pageIndex === pageIndex)
    .map((rect) => normalizedToViewportRect(rect, pageState))
}

function pdfSelectionToolbarPositionFromViewportRects(
  viewportRects: ClientRectLike[],
  pageState: PageState,
) {
  if (viewportRects.length === 0) {
    return null
  }
  const left = Math.min(...viewportRects.map((rect) => rect.left))
  const right = Math.max(...viewportRects.map((rect) => rect.right))
  const top = Math.min(...viewportRects.map((rect) => rect.top))
  const bottom = Math.max(...viewportRects.map((rect) => rect.bottom))
  const estimatedToolbarWidth = Math.min(520, Math.max(280, pageState.width - 32))
  const estimatedToolbarHeight = 52
  const horizontalPadding = 16
  const centerLeft = (left + right) / 2 - estimatedToolbarWidth / 2
  const toolbarLeft = clampNumber(
    centerLeft,
    horizontalPadding,
    Math.max(horizontalPadding, pageState.width - estimatedToolbarWidth - horizontalPadding),
  )
  const topAbove = top - estimatedToolbarHeight - 12
  const topBelow = bottom + 12
  const toolbarTop =
    topAbove >= 16
      ? topAbove
      : clampNumber(topBelow, 16, Math.max(16, pageState.height - estimatedToolbarHeight - 16))
  return { left: toolbarLeft, top: toolbarTop }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function scrollPdfPageIntoScrollerView(scroller: HTMLElement, target: HTMLElement) {
  const scrollerRect = scroller.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const targetTop = Math.max(0, scroller.scrollTop + targetRect.top - scrollerRect.top - 24)
  if (typeof scroller.scrollTo === "function") {
    scroller.scrollTo({ top: targetTop, behavior: "smooth" })
  } else {
    scroller.scrollTop = targetTop
  }
  return targetTop
}

function scrollVirtualPdfPageIntoScrollerView(
  scroller: HTMLElement,
  metrics: ReturnType<typeof buildVirtualPageMetrics>,
  pageIndex: number,
  { behavior = "smooth", topOffset = 0 }: { behavior?: ScrollBehavior; topOffset?: number } = {},
) {
  const targetTop = virtualPageOffset(metrics, pageIndex, topOffset)
  if (typeof scroller.scrollTo === "function") {
    scroller.scrollTo({ top: targetTop, behavior })
  } else {
    scroller.scrollTop = targetTop
  }
  return targetTop
}

function startProgrammaticPdfScroll(
  ref: ProgrammaticPdfScrollRef,
  page: number,
  targetTop: number,
  scroller?: HTMLElement,
) {
  clearProgrammaticPdfScroll(ref)
  const finish = () => {
    if (ref.current?.page === page) {
      clearProgrammaticPdfScroll(ref)
    }
  }
  scroller?.addEventListener("scrollend", finish, { once: true })
  ref.current = {
    page,
    targetTop,
    timeoutId: window.setTimeout(() => {
      finish()
    }, 2200),
    cleanup: scroller ? () => scroller.removeEventListener("scrollend", finish) : undefined,
  }
}

function clearProgrammaticPdfScroll(ref: ProgrammaticPdfScrollRef) {
  if (ref.current) {
    window.clearTimeout(ref.current.timeoutId)
    ref.current.cleanup?.()
    ref.current = null
  }
}

function requestReaderAnimationFrame(callback: FrameRequestCallback) {
  if (typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback)
  }
  return window.setTimeout(() => callback(performance.now()), 16)
}

function cancelReaderAnimationFrame(handle: number) {
  if (handle === 0) {
    return
  }
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(handle)
    return
  }
  window.clearTimeout(handle)
}

function shouldDeferVisiblePdfPageUpdateForProgrammaticScroll(
  ref: ProgrammaticPdfScrollRef,
  scroller: HTMLElement,
  pageRefs: MutableRefObject<Map<number, HTMLElement>>,
  currentPageRef: MutableRefObject<number>,
  onCurrentPageChange: (page: number) => void,
) {
  const pending = ref.current
  if (!pending) {
    return false
  }
  const target = pageRefs.current.get(pending.page - 1)
  if (isProgrammaticPdfPageScrollSettled(scroller, target, pending.targetTop)) {
    const page = pending.page
    clearProgrammaticPdfScroll(ref)
    if (currentPageRef.current !== page) {
      currentPageRef.current = page
      onCurrentPageChange(page)
    }
    return false
  }
  return true
}

function isProgrammaticPdfPageScrollSettled(
  scroller: HTMLElement,
  target: HTMLElement | undefined,
  targetTop: number,
) {
  if (!target) {
    return Math.abs(scroller.scrollTop - targetTop) < 2
  }
  const scrollerRect = scroller.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  return (
    Math.abs(scroller.scrollTop - targetTop) < 2 ||
    (targetRect.top >= scrollerRect.top - 2 && targetRect.top <= scrollerRect.top + 40)
  )
}

function isPdfPageNearScrollerAnchor(scroller: HTMLElement, target: HTMLElement) {
  const scrollerRect = scroller.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  return targetRect.top >= scrollerRect.top + 24 && targetRect.top <= scrollerRect.top + 180
}
