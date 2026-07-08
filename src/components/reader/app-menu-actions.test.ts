import { describe, expect, it, vi } from "vitest"
import { dispatchAppMenuAction, type AppMenuHandlers } from "./app-menu-actions"

function handlers(): AppMenuHandlers {
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

describe("dispatchAppMenuAction", () => {
  it("maps every simple action id to its handler", () => {
    const cases: Array<[string, keyof AppMenuHandlers]> = [
      ["menu:import", "onImport"],
      ["menu:library", "onToggleLibrary"],
      ["menu:search", "onToggleSearch"],
      ["menu:settings", "onToggleSettings"],
      ["menu:obsidian", "onOpenObsidianSettings"],
      ["menu:sidebar", "onToggleSidebar"],
      ["menu:appearance", "onToggleAppearance"],
    ]
    for (const [actionId, handlerName] of cases) {
      const h = handlers()
      expect(dispatchAppMenuAction(actionId, h)).toBe(true)
      expect(h[handlerName]).toHaveBeenCalledTimes(1)
    }
  })

  it("maps view ids to onSelectView with the right view", () => {
    for (const view of ["text", "tldr", "translation", "knowledge", "pdf"]) {
      const h = handlers()
      expect(dispatchAppMenuAction(`menu:view:${view}`, h)).toBe(true)
      expect(h.onSelectView).toHaveBeenCalledWith(view)
    }
  })

  it("ignores unknown ids without calling anything", () => {
    const h = handlers()
    expect(dispatchAppMenuAction("menu:view:nope", h)).toBe(false)
    expect(dispatchAppMenuAction("menu:future-thing", h)).toBe(false)
    expect(dispatchAppMenuAction("", h)).toBe(false)
    for (const fn of Object.values(h)) {
      expect(fn).not.toHaveBeenCalled()
    }
  })
})
