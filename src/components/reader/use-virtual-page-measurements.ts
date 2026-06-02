import { useCallback, useEffect, useRef, useState } from "react"

type ResetMeasuredPageHeightsOptions = {
  preserveExisting?: boolean
}

function measuredElementHeight(element: HTMLElement) {
  return element.getBoundingClientRect().height || element.offsetHeight
}

function requestMeasurementFrame(callback: FrameRequestCallback) {
  if (typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback)
  }
  return window.setTimeout(() => callback(performance.now()), 16)
}

function cancelMeasurementFrame(handle: number) {
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(handle)
    return
  }
  window.clearTimeout(handle)
}

export function useVirtualPageMeasurements() {
  const pageRefs = useRef(new Map<number, HTMLElement>())
  const observersRef = useRef(new Map<number, ResizeObserver>())
  const refCallbacksRef = useRef(new Map<number, (element: HTMLElement | null) => void>())
  const measurementFramesRef = useRef(new Map<number, number>())
  const [measuredPageHeights, setMeasuredPageHeights] = useState(
    () => new Map<number, number>(),
  )

  const storeMeasuredHeight = useCallback((pageIndex: number, element: HTMLElement) => {
    const height = measuredElementHeight(element)
    if (height <= 0) {
      return
    }
    setMeasuredPageHeights((current) => {
      if (current.get(pageIndex) === height) {
        return current
      }
      const next = new Map(current)
      next.set(pageIndex, height)
      return next
    })
  }, [])

  const cancelScheduledMeasurement = useCallback((pageIndex: number) => {
    const frame = measurementFramesRef.current.get(pageIndex)
    if (frame !== undefined) {
      cancelMeasurementFrame(frame)
      measurementFramesRef.current.delete(pageIndex)
    }
  }, [])

  const scheduleMeasuredHeight = useCallback(
    (pageIndex: number, element: HTMLElement) => {
      cancelScheduledMeasurement(pageIndex)
      const frame = requestMeasurementFrame(() => {
        measurementFramesRef.current.delete(pageIndex)
        if (pageRefs.current.get(pageIndex) !== element) {
          return
        }
        storeMeasuredHeight(pageIndex, element)
      })
      measurementFramesRef.current.set(pageIndex, frame)
    },
    [cancelScheduledMeasurement, storeMeasuredHeight],
  )

  const getPageMeasurementRef = useCallback(
    (pageIndex: number) => {
      const existing = refCallbacksRef.current.get(pageIndex)
      if (existing) {
        return existing
      }

      const callback = (element: HTMLElement | null) => {
        const observer = observersRef.current.get(pageIndex)
        if (observer) {
          observer.disconnect()
          observersRef.current.delete(pageIndex)
        }

        if (!element) {
          cancelScheduledMeasurement(pageIndex)
          pageRefs.current.delete(pageIndex)
          return
        }

        pageRefs.current.set(pageIndex, element)
        scheduleMeasuredHeight(pageIndex, element)

        if (typeof ResizeObserver !== "undefined") {
          const nextObserver = new ResizeObserver(() => {
            scheduleMeasuredHeight(pageIndex, element)
          })
          nextObserver.observe(element)
          observersRef.current.set(pageIndex, nextObserver)
        }
      }

      refCallbacksRef.current.set(pageIndex, callback)
      return callback
    },
    [cancelScheduledMeasurement, scheduleMeasuredHeight],
  )

  const resetMeasuredPageHeights = useCallback((options: ResetMeasuredPageHeightsOptions = {}) => {
    for (const pageIndex of measurementFramesRef.current.keys()) {
      cancelScheduledMeasurement(pageIndex)
    }
    if (!options.preserveExisting) {
      setMeasuredPageHeights(new Map())
    }
    requestMeasurementFrame(() => {
      setMeasuredPageHeights((current) => {
        const next = options.preserveExisting
          ? new Map(current)
          : new Map<number, number>()
        for (const [pageIndex, element] of pageRefs.current) {
          const height = measuredElementHeight(element)
          if (height > 0) {
            next.set(pageIndex, height)
          }
        }
        return measuredHeightMapsEqual(current, next) ? current : next
      })
    })
  }, [])

  useEffect(() => {
    return () => {
      for (const observer of observersRef.current.values()) {
        observer.disconnect()
      }
      for (const frame of measurementFramesRef.current.values()) {
        cancelMeasurementFrame(frame)
      }
      observersRef.current.clear()
      measurementFramesRef.current.clear()
      refCallbacksRef.current.clear()
      pageRefs.current.clear()
    }
  }, [])

  return {
    pageRefs,
    measuredPageHeights,
    getPageMeasurementRef,
    resetMeasuredPageHeights,
  }
}

function measuredHeightMapsEqual(left: Map<number, number>, right: Map<number, number>) {
  if (left.size !== right.size) {
    return false
  }
  for (const [pageIndex, height] of left) {
    if (right.get(pageIndex) !== height) {
      return false
    }
  }
  return true
}
