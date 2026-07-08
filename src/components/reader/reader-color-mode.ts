/**
 * 明/暗/跟随系统三态。"system" 会读取 prefers-color-scheme 并实时跟随;
 * light/dark 为用户显式选择。持久化的只是这个三态设置,真正生效的
 * resolved 模式("light" | "dark")由 use-reader-appearance 结合系统偏好推导。
 */
export const READER_COLOR_MODE_STORAGE_KEY = "focused-reading.reader-color-mode.v1"

export type ReaderColorMode = "light" | "dark" | "system"
export type ReaderResolvedColorMode = "light" | "dark"

export const readerColorModeOptions: { id: ReaderColorMode; label: string }[] = [
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
  { id: "system", label: "跟随系统" },
]

const KNOWN_MODES: ReaderColorMode[] = ["light", "dark", "system"]

export function normalizeReaderColorMode(value: string | null | undefined): ReaderColorMode {
  return value && (KNOWN_MODES as string[]).includes(value)
    ? (value as ReaderColorMode)
    : "system"
}

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)"

/** 读取系统是否偏好深色;在无 matchMedia 的环境(测试/SSR)返回 false。 */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false
  }
  return window.matchMedia(DARK_MEDIA_QUERY).matches
}

/** 把三态设置结合系统偏好推导为真正生效的模式。 */
export function resolveReaderColorMode(
  mode: ReaderColorMode,
  prefersDark: boolean,
): ReaderResolvedColorMode {
  if (mode === "system") {
    return prefersDark ? "dark" : "light"
  }
  return mode
}

/**
 * 订阅系统深色偏好变化;仅在 matchMedia 可用时生效,返回取消订阅函数。
 * 立即以当前值回调一次,便于消费者初始化。
 */
export function subscribeSystemColorScheme(
  onChange: (prefersDark: boolean) => void,
): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined
  }
  const mediaQuery = window.matchMedia(DARK_MEDIA_QUERY)
  const handleChange = () => onChange(mediaQuery.matches)
  handleChange()
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }
  mediaQuery.addListener(handleChange)
  return () => mediaQuery.removeListener(handleChange)
}
