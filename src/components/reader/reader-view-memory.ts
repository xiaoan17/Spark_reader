import { useEffect, useRef, type Dispatch, type SetStateAction } from "react"
import type { ReaderView } from "./highlight-target-view"
import { clampPage } from "./page-navigation"

type ReaderViewPageMemory = Record<ReaderView, number>

export function useReaderViewMemory({
  readerView,
  currentPage,
  totalPages,
  setReaderView,
  onPageChange,
}: {
  readerView: ReaderView
  currentPage: number
  totalPages: number
  setReaderView: Dispatch<SetStateAction<ReaderView>>
  onPageChange: (page: number) => void
}) {
  const memoryRef = useRef<ReaderViewPageMemory>({
    text: 1,
    tldr: 1,
    translation: 1,
    pdf: 1,
  })

  useEffect(() => {
    memoryRef.current[readerView] = clampPage(currentPage, totalPages)
  }, [currentPage, readerView, totalPages])

  function rememberCurrentViewPage() {
    memoryRef.current[readerView] = clampPage(currentPage, totalPages)
  }

  function switchReaderView(nextView: ReaderView, options: { page?: number; restorePage?: boolean } = {}) {
    rememberCurrentViewPage()
    setReaderView(nextView)
    const targetPage =
      options.page ??
      (options.restorePage === false ? currentPage : memoryRef.current[nextView])
    const safeTargetPage = clampPage(targetPage, totalPages)
    if (safeTargetPage !== clampPage(currentPage, totalPages)) {
      onPageChange(safeTargetPage)
    }
  }

  return {
    switchReaderView,
    rememberCurrentViewPage,
  }
}
