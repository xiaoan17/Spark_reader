import { useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react"
import { TextLayer, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from "@/pdf/pdfjs-compat"
import type { NormalizedPageRect } from "@/core/coordinates"
import {
  normalizedToViewportRect,
  rectToCss,
  viewportRectToNormalized,
} from "@/core/coordinates"
import { SelectionToolbar } from "@/components/selection/SelectionToolbar"
import type { TextSelectionAnchor } from "@/stores/reader-store"
import { textSelectionAnchorFromDom } from "./text-selection-anchor"

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
  const pageRefs = useRef(new Map<number, HTMLElement>())
  const currentPageRef = useRef(currentPage)
  const observedPageChangeRef = useRef<number | null>(null)
  const programmaticScrollRef = useRef<ProgrammaticPdfScroll | null>(null)
  const pageNumbers = useMemo(
    () => Array.from({ length: totalPages }, (_, index) => index + 1),
    [totalPages],
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
    const handleScroll = () => {
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

      for (const [pageNumber, element] of pageRefs.current) {
        const rect = element.getBoundingClientRect()
        if (rect.bottom < scrollerRect.top || rect.top > scrollerRect.bottom) {
          continue
        }
        const distance = Math.abs(rect.top - viewportAnchor)
        if (distance < bestDistance) {
          bestDistance = distance
          bestPage = pageNumber
        }
      }

      if (bestPage !== currentPageRef.current) {
        currentPageRef.current = bestPage
        observedPageChangeRef.current = bestPage
        onCurrentPageChange(bestPage)
      }
    }

    scroller.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll()
    return () => scroller.removeEventListener("scroll", handleScroll)
  }, [onCurrentPageChange, pageNumbers])

  useEffect(() => {
    const target = pageRefs.current.get(currentPage)
    const scroller = scrollerRef.current
    if (!target || !scroller) {
      return
    }
    if (observedPageChangeRef.current === currentPage) {
      observedPageChangeRef.current = null
      return
    }
    if (isPdfPageNearScrollerAnchor(scroller, target)) {
      return
    }
    const targetTop = scrollPdfPageIntoScrollerView(scroller, target)
    startProgrammaticPdfScroll(programmaticScrollRef, currentPage, targetTop)
  }, [currentPage, pageNumbers])

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
      <div className="mx-auto flex min-w-max flex-col items-center gap-8">
        {pageNumbers.map((pageNumber) => (
          <section
            key={pageNumber}
            ref={(element) => {
              if (element) {
                pageRefs.current.set(pageNumber, element)
              } else {
                pageRefs.current.delete(pageNumber)
              }
            }}
            className="scroll-mt-8"
            data-pdf-page-wrapper
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
        ))}
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
    let textLayer: TextLayer | null = null

    async function renderPage() {
      try {
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

  const visibleHighlightRects = highlightRects.filter((rect) => rect.pageIndex === pageNumber - 1)
  const visibleSelectionRects = selectionRects.filter((rect) => rect.pageIndex === pageNumber - 1)
  const visibleRects = [...visibleHighlightRects, ...visibleSelectionRects]

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
        ? visibleRects.map((rect, index) => {
            const viewportRect = normalizedToViewportRect(rect, pageState)
            return (
              <div
                key={`${pageNumber}-${index}`}
                className="pointer-events-none absolute z-[2] rounded-sm bg-teal-300/35"
                style={rectToCss(viewportRect)}
              />
            )
          })
        : null}
      {visibleSelectionRects.length > 0 ? (
        <SelectionToolbar
          approximate={approximateSelection}
          askOpen={askOpen}
          className="absolute left-8 top-8 z-10"
          question={question}
          onAskToggle={onAskToggle}
          onCopy={onCopy}
          onExplain={onExplain}
          onHighlight={onHighlight}
          onPlainExplain={onPlainExplain}
          onQuestionChange={onQuestionChange}
          onQuestionSubmit={onQuestionSubmit}
        />
      ) : null}
    </div>
  )
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

function startProgrammaticPdfScroll(
  ref: ProgrammaticPdfScrollRef,
  page: number,
  targetTop: number,
) {
  clearProgrammaticPdfScroll(ref)
  ref.current = {
    page,
    targetTop,
    timeoutId: window.setTimeout(() => {
      if (ref.current?.page === page) {
        ref.current = null
      }
    }, 1400),
  }
}

function clearProgrammaticPdfScroll(ref: ProgrammaticPdfScrollRef) {
  if (ref.current) {
    window.clearTimeout(ref.current.timeoutId)
    ref.current = null
  }
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
  const target = pageRefs.current.get(pending.page)
  if (!target) {
    clearProgrammaticPdfScroll(ref)
    return false
  }
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
  target: HTMLElement,
  targetTop: number,
) {
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
