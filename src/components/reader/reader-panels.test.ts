import { describe, expect, it } from "vitest"
import {
  initialReaderPanelState,
  readerPanelReducer,
  type ReaderPanelState,
} from "./reader-panels"

describe("reader panel reducer", () => {
  it("toggles individual panels without changing unrelated panel state", () => {
    const state = readerPanelReducer(initialReaderPanelState, {
      type: "toggle",
      panel: "searchOpen",
    })

    expect(state.searchOpen).toBe(true)
    expect(state.sidebarOpen).toBe(true)
    expect(state.importMenuOpen).toBe(false)
  })

  it("returns the same object when setting a panel to its existing value", () => {
    const state = readerPanelReducer(initialReaderPanelState, {
      type: "set",
      panel: "settingsOpen",
      open: false,
    })

    expect(state).toBe(initialReaderPanelState)
  })

  it("can reset to defaults with an override", () => {
    const dirty: ReaderPanelState = {
      ...initialReaderPanelState,
      searchOpen: true,
      settingsOpen: true,
      zoteroOpen: true,
    }

    expect(
      readerPanelReducer(dirty, {
        type: "reset",
        next: { onboardingOpen: true },
      }),
    ).toEqual({
      ...initialReaderPanelState,
      onboardingOpen: true,
    })
  })
})
