import { useEffect, useState, type FormEvent } from "react"

export type ReaderPageNavigation = {
  safePage: number
  progress: number
  pageJumpValue: string
  setPageJumpValue: (value: string) => void
  goToPage: (page: number) => boolean
  goToPreviousPage: () => boolean
  goToNextPage: () => boolean
  handlePageJumpSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function useReaderPageNavigation({
  currentPage,
  totalPages,
  onPageChange,
  onInvalidPage,
}: {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  onInvalidPage?: () => void
}): ReaderPageNavigation {
  const safePage = clampPage(currentPage || 1, totalPages)
  const progress = totalPages > 0 ? (safePage / totalPages) * 100 : 0
  const [pageJumpValue, setPageJumpValue] = useState(String(safePage))

  useEffect(() => {
    setPageJumpValue(String(safePage))
  }, [safePage])

  function goToPage(page: number) {
    if (!Number.isFinite(page) || totalPages <= 0) {
      onInvalidPage?.()
      return false
    }
    onPageChange(clampPage(page, totalPages))
    return true
  }

  function handlePageJumpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const page = Number.parseInt(pageJumpValue, 10)
    if (!goToPage(page)) {
      return
    }
  }

  return {
    safePage,
    progress,
    pageJumpValue,
    setPageJumpValue,
    goToPage,
    goToPreviousPage: () => goToPage(safePage - 1),
    goToNextPage: () => goToPage(safePage + 1),
    handlePageJumpSubmit,
  }
}

export function clampPage(page: number, totalPages: number) {
  if (!Number.isFinite(page) || totalPages <= 0) {
    return 1
  }
  return Math.min(Math.max(Math.floor(page), 1), totalPages)
}
