import type { MutableRefObject } from "react"
import type { buildVirtualPageMetrics } from "./virtual-pages"
import { virtualPageOffset } from "./virtual-pages"

export type ProgrammaticPageScroll = {
  page: number
  targetTop: number
  timeoutId: number
  cleanup?: () => void
}

export type ProgrammaticPageScrollRef = MutableRefObject<ProgrammaticPageScroll | null>

export function scrollElementIntoScrollerView(
  scroller: HTMLElement,
  target: HTMLElement,
  { behavior = "smooth", topOffset = 0 }: { behavior?: ScrollBehavior; topOffset?: number } = {},
) {
  const scrollerRect = scroller.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const targetTop = Math.max(0, scroller.scrollTop + targetRect.top - scrollerRect.top - topOffset)
  if (typeof scroller.scrollTo === "function") {
    scroller.scrollTo({ top: targetTop, behavior })
  } else {
    scroller.scrollTop = targetTop
  }
  return targetTop
}

export function scrollVirtualPageIntoScrollerView(
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

export function startProgrammaticPageScroll(
  ref: ProgrammaticPageScrollRef,
  page: number,
  targetTop: number,
  scroller?: HTMLElement,
) {
  clearProgrammaticPageScroll(ref)
  const finish = () => {
    if (ref.current?.page === page) {
      clearProgrammaticPageScroll(ref)
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

export function clearProgrammaticPageScroll(ref: ProgrammaticPageScrollRef) {
  if (ref.current) {
    window.clearTimeout(ref.current.timeoutId)
    ref.current.cleanup?.()
    ref.current = null
  }
}

export function requestReaderAnimationFrame(callback: FrameRequestCallback) {
  if (typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback)
  }
  return window.setTimeout(() => callback(performance.now()), 16)
}

export function cancelReaderAnimationFrame(handle: number) {
  if (handle === 0) {
    return
  }
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(handle)
    return
  }
  window.clearTimeout(handle)
}

export function reportVisiblePageFromReaderScroll(
  ref: MutableRefObject<number | null>,
  page: number,
  onCurrentPageChange: (page: number) => void,
) {
  ref.current = page
  onCurrentPageChange(page)
}

export function consumeVisiblePageUpdateFromReaderScroll(
  ref: MutableRefObject<number | null>,
  page: number,
) {
  if (ref.current !== page) {
    return false
  }
  ref.current = null
  return true
}

export function shouldDeferVisiblePageUpdateForProgrammaticScroll(
  ref: ProgrammaticPageScrollRef,
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
  if (isProgrammaticPageScrollSettled(scroller, target, pending.targetTop)) {
    const page = pending.page
    clearProgrammaticPageScroll(ref)
    if (currentPageRef.current !== page) {
      currentPageRef.current = page
      onCurrentPageChange(page)
    }
    return false
  }
  return true
}

export function isPageNearReaderAnchor(scroller: HTMLElement, target: HTMLElement) {
  const scrollerRect = scroller.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  return targetRect.top >= scrollerRect.top + 24 && targetRect.top <= scrollerRect.top + 180
}

function isProgrammaticPageScrollSettled(
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
    (targetRect.top >= scrollerRect.top - 2 && targetRect.top <= scrollerRect.top + 36)
  )
}
