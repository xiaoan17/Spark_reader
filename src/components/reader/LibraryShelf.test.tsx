import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { StoredBookSummary } from "@/core/library-api"
import { LibraryShelf } from "./LibraryShelf"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

function storedBook(overrides: Partial<StoredBookSummary> = {}): StoredBookSummary {
  return {
    bookId: "book-1",
    title: "测试图书",
    totalPages: 10,
    parserEngine: "mineru-layout",
    coordinateMode: "normalized-page-rects",
    textCharCount: 1000,
    markdownCharCount: 1200,
    chunkCount: 12,
    createdAt: "2026-06-03T08:00:00",
    textPath: "",
    markdownPath: "",
    originalPdfPath: "",
    sourcePdfPath: "",
    sourcePdfFingerprint: "",
    quality: null,
    ...overrides,
  }
}

let activeRoot: Root | null = null
let activeContainer: HTMLDivElement | null = null

async function renderShelf(onDelete: (bookId: string) => void) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  activeRoot = root
  activeContainer = container
  await act(async () => {
    root.render(
      <LibraryShelf
        open
        books={[storedBook()]}
        activeBookId="book-1"
        persistenceLabel="导入后保存到本机书库"
        onClose={() => undefined}
        onRefresh={() => undefined}
        onOpen={() => undefined}
        onDelete={onDelete}
      />,
    )
    await Promise.resolve()
  })
  return container
}

async function click(element: Element | null | undefined) {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
  })
}

function deleteButton(container: HTMLElement) {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    button.getAttribute("aria-label")?.startsWith("删除"),
  )
}

function dialogButton(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll("[role='dialog'] button")).find(
    (button) => button.textContent?.trim() === label,
  )
}

afterEach(() => {
  if (activeRoot) {
    act(() => activeRoot?.unmount())
    activeRoot = null
  }
  activeContainer?.remove()
  activeContainer = null
})

describe("LibraryShelf delete confirmation", () => {
  it("does not delete immediately; only confirmation triggers onDelete", async () => {
    const onDelete = vi.fn()
    const container = await renderShelf(onDelete)

    await click(deleteButton(container))

    expect(onDelete).not.toHaveBeenCalled()
    expect(container.querySelector("[role='dialog']")).toBeTruthy()

    await click(dialogButton(container, "确认删除"))

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith("book-1")
    expect(container.querySelector("[role='dialog']")).toBeNull()
  })

  it("cancel closes the dialog without deleting", async () => {
    const onDelete = vi.fn()
    const container = await renderShelf(onDelete)

    await click(deleteButton(container))
    expect(container.querySelector("[role='dialog']")).toBeTruthy()

    await click(dialogButton(container, "取消"))

    expect(onDelete).not.toHaveBeenCalled()
    expect(container.querySelector("[role='dialog']")).toBeNull()
  })

  it("Escape cancels the dialog without deleting", async () => {
    const onDelete = vi.fn()
    const container = await renderShelf(onDelete)

    await click(deleteButton(container))
    expect(container.querySelector("[role='dialog']")).toBeTruthy()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
      await Promise.resolve()
    })

    expect(onDelete).not.toHaveBeenCalled()
    expect(container.querySelector("[role='dialog']")).toBeNull()
  })
})
