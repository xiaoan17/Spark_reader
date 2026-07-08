import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useReaderShortcuts } from "./use-reader-shortcuts"
import type { AppMenuHandlers } from "./app-menu-actions"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const isTauriRuntime = vi.fn(() => false)
vi.mock("@/core/library-api", () => ({
  isTauriRuntime: () => isTauriRuntime(),
}))

function appMenuHandlers(): AppMenuHandlers {
  return {
    onImport: vi.fn(),
    onToggleLibrary: vi.fn(),
    onToggleSearch: vi.fn(),
    onToggleSettings: vi.fn(),
    onOpenObsidianSettings: vi.fn(),
    onToggleSidebar: vi.fn(),
    onToggleAppearance: vi.fn(),
    onSelectView: vi.fn(),
  }
}

type HarnessDeps = {
  selectionText?: string
  runDeepInterpretation?: () => void
  setQuestion?: (question: string) => void
  onClearSelection?: () => void
  handlers: AppMenuHandlers
}

function Harness({ selectionText = "", runDeepInterpretation = () => undefined, setQuestion = () => undefined, onClearSelection = () => undefined, handlers }: HarnessDeps) {
  useReaderShortcuts({
    selectionText,
    runDeepInterpretation,
    setQuestion,
    onClearSelection,
    appMenuHandlers: handlers,
  })
  return <input data-testid="editable" />
}

let activeRoot: Root | null = null
let activeContainer: HTMLDivElement | null = null

async function render(deps: HarnessDeps) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  activeRoot = root
  activeContainer = container
  await act(async () => {
    root.render(<Harness {...deps} />)
    await Promise.resolve()
  })
  return container
}

async function press(init: KeyboardEventInit, target: EventTarget = window) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }))
    await Promise.resolve()
  })
}

beforeEach(() => {
  isTauriRuntime.mockReturnValue(false)
})

afterEach(() => {
  if (activeRoot) {
    act(() => activeRoot?.unmount())
    activeRoot = null
  }
  activeContainer?.remove()
  activeContainer = null
})

describe("useReaderShortcuts (browser app-menu mirror)", () => {
  it("maps each Cmd combo to the shared app-menu handler", async () => {
    const handlers = appMenuHandlers()
    await render({ handlers })

    await press({ metaKey: true, key: "f" })
    expect(handlers.onToggleSearch).toHaveBeenCalledTimes(1)

    await press({ metaKey: true, key: "o" })
    expect(handlers.onImport).toHaveBeenCalledTimes(1)

    await press({ metaKey: true, key: "l" })
    expect(handlers.onToggleLibrary).toHaveBeenCalledTimes(1)

    await press({ metaKey: true, key: "\\" })
    expect(handlers.onToggleSidebar).toHaveBeenCalledTimes(1)
  })

  it("maps Cmd+1..5 to the five reader views in order", async () => {
    const handlers = appMenuHandlers()
    await render({ handlers })

    const views = ["text", "tldr", "translation", "knowledge", "pdf"]
    for (let index = 0; index < views.length; index += 1) {
      await press({ metaKey: true, key: String(index + 1) })
    }
    expect((handlers.onSelectView as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])).toEqual(
      views,
    )
  })

  it("uses ctrlKey on non-mac platforms", async () => {
    const handlers = appMenuHandlers()
    await render({ handlers })

    await press({ ctrlKey: true, key: "f" })
    expect(handlers.onToggleSearch).toHaveBeenCalledTimes(1)
  })

  it("exempts Cmd+1..5 and Cmd+\\ when focus is in an editable element, but still intercepts Cmd+F/O/L", async () => {
    const handlers = appMenuHandlers()
    const container = await render({ handlers })
    const input = container.querySelector<HTMLInputElement>("[data-testid='editable']")!

    await press({ metaKey: true, key: "1" }, input)
    await press({ metaKey: true, key: "\\" }, input)
    expect(handlers.onSelectView).not.toHaveBeenCalled()
    expect(handlers.onToggleSidebar).not.toHaveBeenCalled()

    await press({ metaKey: true, key: "f" }, input)
    await press({ metaKey: true, key: "o" }, input)
    await press({ metaKey: true, key: "l" }, input)
    expect(handlers.onToggleSearch).toHaveBeenCalledTimes(1)
    expect(handlers.onImport).toHaveBeenCalledTimes(1)
    expect(handlers.onToggleLibrary).toHaveBeenCalledTimes(1)
  })

  it("does not register app-menu keys on desktop (Tauri) to avoid double-fire", async () => {
    isTauriRuntime.mockReturnValue(true)
    const handlers = appMenuHandlers()
    await render({ handlers })

    await press({ metaKey: true, key: "f" })
    await press({ metaKey: true, key: "1" })
    expect(handlers.onToggleSearch).not.toHaveBeenCalled()
    expect(handlers.onSelectView).not.toHaveBeenCalled()
  })
})

describe("useReaderShortcuts (selection shortcuts)", () => {
  it("Cmd+E deep-interprets when a selection exists", async () => {
    const handlers = appMenuHandlers()
    const runDeepInterpretation = vi.fn()
    await render({ handlers, runDeepInterpretation, selectionText: "复利" })

    await press({ metaKey: true, key: "e" })
    expect(runDeepInterpretation).toHaveBeenCalledTimes(1)
  })

  it("Escape clears the selection and question", async () => {
    const handlers = appMenuHandlers()
    const onClearSelection = vi.fn()
    const setQuestion = vi.fn()
    await render({ handlers, onClearSelection, setQuestion, selectionText: "复利" })

    await press({ key: "Escape" })
    expect(onClearSelection).toHaveBeenCalledTimes(1)
    expect(setQuestion).toHaveBeenCalledWith("")
  })

  it("Cmd+E is exempt while typing in an input", async () => {
    const handlers = appMenuHandlers()
    const runDeepInterpretation = vi.fn()
    const container = await render({ handlers, runDeepInterpretation, selectionText: "复利" })
    const input = container.querySelector<HTMLInputElement>("[data-testid='editable']")!

    await press({ metaKey: true, key: "e" }, input)
    expect(runDeepInterpretation).not.toHaveBeenCalled()
  })
})
