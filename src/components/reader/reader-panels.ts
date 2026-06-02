import { useReducer } from "react"

export type ReaderPanelState = {
  sidebarOpen: boolean
  searchOpen: boolean
  settingsOpen: boolean
  libraryOpen: boolean
  importMenuOpen: boolean
  onboardingOpen: boolean
  zoteroOpen: boolean
}

export type ReaderPanelName = keyof ReaderPanelState

export type ReaderPanelAction =
  | { type: "set"; panel: ReaderPanelName; open: boolean }
  | { type: "toggle"; panel: ReaderPanelName }
  | { type: "reset"; next?: Partial<ReaderPanelState> }

export const initialReaderPanelState: ReaderPanelState = {
  sidebarOpen: true,
  searchOpen: false,
  settingsOpen: false,
  libraryOpen: false,
  importMenuOpen: false,
  onboardingOpen: false,
  zoteroOpen: false,
}

export function readerPanelReducer(
  state: ReaderPanelState,
  action: ReaderPanelAction,
): ReaderPanelState {
  switch (action.type) {
    case "set":
      if (state[action.panel] === action.open) {
        return state
      }
      return { ...state, [action.panel]: action.open }
    case "toggle":
      return { ...state, [action.panel]: !state[action.panel] }
    case "reset":
      return { ...initialReaderPanelState, ...action.next }
  }
}

export function useReaderPanels(initialState?: Partial<ReaderPanelState>) {
  const [panels, dispatchPanels] = useReducer(readerPanelReducer, {
    ...initialReaderPanelState,
    ...initialState,
  })
  const setPanelOpen = (panel: ReaderPanelName, open: boolean) => {
    dispatchPanels({ type: "set", panel, open })
  }
  const togglePanel = (panel: ReaderPanelName) => {
    dispatchPanels({ type: "toggle", panel })
  }
  return { panels, setPanelOpen, togglePanel, dispatchPanels }
}
