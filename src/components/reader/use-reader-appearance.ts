import { useCallback, useEffect, useMemo, useState } from "react"
import {
  READER_DISPLAY_THEME_STORAGE_KEY,
  normalizeReaderDisplayThemeId,
  readerDisplayThemeById,
  readerDisplayThemeStyle,
  type ReaderDisplayThemeId,
  type ReaderDisplayThemeStyle,
} from "./reader-display-theme"
import {
  READER_COLOR_MODE_STORAGE_KEY,
  normalizeReaderColorMode,
  resolveReaderColorMode,
  subscribeSystemColorScheme,
  systemPrefersDark,
  type ReaderColorMode,
  type ReaderResolvedColorMode,
} from "./reader-color-mode"
import {
  READER_TYPOGRAPHY_STORAGE_KEY,
  defaultReaderTypographyOverrides,
  hasReaderTypographyOverride,
  normalizeReaderTypographyOverrides,
  readerTypographyStyle,
  type ReaderTypographyOverrides,
} from "./reader-typography"

export type ReaderAppearance = {
  displayThemeId: ReaderDisplayThemeId
  colorMode: ReaderColorMode
  resolvedColorMode: ReaderResolvedColorMode
  typography: ReaderTypographyOverrides
  hasTypographyOverride: boolean
  /** 主题(按明暗解析)与用户排版覆盖叠加后的最终 CSS 变量。 */
  readerDisplayStyle: ReaderDisplayThemeStyle
  setDisplayThemeId: (id: ReaderDisplayThemeId) => void
  setColorMode: (mode: ReaderColorMode) => void
  setTypographyOverride: <K extends keyof ReaderTypographyOverrides>(
    key: K,
    value: ReaderTypographyOverrides[K],
  ) => void
  resetTypography: () => void
}

function readInitialDisplayThemeId(): ReaderDisplayThemeId {
  try {
    return normalizeReaderDisplayThemeId(
      window.localStorage.getItem(READER_DISPLAY_THEME_STORAGE_KEY),
    )
  } catch {
    return "spark-paper"
  }
}

function readInitialColorMode(): ReaderColorMode {
  try {
    return normalizeReaderColorMode(window.localStorage.getItem(READER_COLOR_MODE_STORAGE_KEY))
  } catch {
    return "system"
  }
}

function readInitialTypography(): ReaderTypographyOverrides {
  try {
    const raw = window.localStorage.getItem(READER_TYPOGRAPHY_STORAGE_KEY)
    return normalizeReaderTypographyOverrides(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...defaultReaderTypographyOverrides }
  }
}

function persist(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 持久化尽力而为;内存态已经切换,失败不影响本次会话。
  }
}

/**
 * 阅读外观状态中枢:阅读主题 + 明暗三态 + 用户排版覆盖。集中处理持久化、
 * 系统深色偏好订阅、根元素 `.dark` class 切换,并产出叠加后的 CSS 变量。
 * 全部为视图级 UI 状态,不进入 ReaderShell 的 props 契约。
 */
export function useReaderAppearance(): ReaderAppearance {
  const [displayThemeId, setDisplayThemeIdState] = useState<ReaderDisplayThemeId>(
    readInitialDisplayThemeId,
  )
  const [colorMode, setColorModeState] = useState<ReaderColorMode>(readInitialColorMode)
  const [typography, setTypography] = useState<ReaderTypographyOverrides>(readInitialTypography)
  const [prefersDark, setPrefersDark] = useState<boolean>(systemPrefersDark)

  useEffect(() => subscribeSystemColorScheme(setPrefersDark), [])

  const resolvedColorMode = resolveReaderColorMode(colorMode, prefersDark)

  // 根元素 `.dark` class:驱动 tailwind dark: 体系与基础 token,与阅读器变量并行生效。
  useEffect(() => {
    if (typeof document === "undefined") {
      return
    }
    const root = document.documentElement
    root.classList.toggle("dark", resolvedColorMode === "dark")
  }, [resolvedColorMode])

  const setDisplayThemeId = useCallback((id: ReaderDisplayThemeId) => {
    const normalized = normalizeReaderDisplayThemeId(id)
    setDisplayThemeIdState(normalized)
    persist(READER_DISPLAY_THEME_STORAGE_KEY, normalized)
  }, [])

  const setColorMode = useCallback((mode: ReaderColorMode) => {
    const normalized = normalizeReaderColorMode(mode)
    setColorModeState(normalized)
    persist(READER_COLOR_MODE_STORAGE_KEY, normalized)
  }, [])

  const setTypographyOverride = useCallback(
    <K extends keyof ReaderTypographyOverrides>(
      key: K,
      value: ReaderTypographyOverrides[K],
    ) => {
      setTypography((current) => {
        const next = { ...current, [key]: value }
        persist(READER_TYPOGRAPHY_STORAGE_KEY, JSON.stringify(next))
        return next
      })
    },
    [],
  )

  const resetTypography = useCallback(() => {
    const next = { ...defaultReaderTypographyOverrides }
    setTypography(next)
    persist(READER_TYPOGRAPHY_STORAGE_KEY, JSON.stringify(next))
  }, [])

  const readerDisplayStyle = useMemo<ReaderDisplayThemeStyle>(() => {
    const theme = readerDisplayThemeById(displayThemeId)
    // 主题变量先注入,用户排版覆盖后展开 —— 后者优先(同一 CSS 变量管道)。
    return {
      ...readerDisplayThemeStyle(displayThemeId, resolvedColorMode),
      ...readerTypographyStyle(typography, theme),
    }
  }, [displayThemeId, resolvedColorMode, typography])

  return {
    displayThemeId,
    colorMode,
    resolvedColorMode,
    typography,
    hasTypographyOverride: hasReaderTypographyOverride(typography),
    readerDisplayStyle,
    setDisplayThemeId,
    setColorMode,
    setTypographyOverride,
    resetTypography,
  }
}
