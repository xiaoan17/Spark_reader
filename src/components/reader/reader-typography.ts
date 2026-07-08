import type { ReaderDisplayTheme, ReaderDisplayThemeStyle } from "./reader-display-theme"

/**
 * 用户排版覆盖项:与阅读主题解耦。主题只提供字号/行距/页宽的默认值,
 * 用户在这里的选择在主题变量注入之后覆盖生效(同一 CSS 变量管道),
 * 因此切换主题不会重置用户的排版选择。未设置(null)时跟随当前主题默认。
 */
export const READER_TYPOGRAPHY_STORAGE_KEY = "focused-reading.reader-typography.v1"

export type ReaderFontScaleStepId = "xs" | "sm" | "md" | "lg" | "xl"
export type ReaderLineHeightStepId = "tight" | "snug" | "normal" | "relaxed"
export type ReaderPageWidthStepId = "narrow" | "medium" | "wide"

export type ReaderTypographyOverrides = {
  /** 字号档位:作为倍率作用于当前主题的基准字号(null = 跟随主题) */
  fontScale: ReaderFontScaleStepId | null
  /** 行距:绝对值覆盖(null = 跟随主题) */
  lineHeight: ReaderLineHeightStepId | null
  /** 正文页宽:绝对值覆盖(null = 跟随主题) */
  pageWidth: ReaderPageWidthStepId | null
}

export const defaultReaderTypographyOverrides: ReaderTypographyOverrides = {
  fontScale: null,
  lineHeight: null,
  pageWidth: null,
}

export type ReaderFontScaleStep = {
  id: ReaderFontScaleStepId
  label: string
  multiplier: number
}

export type ReaderLineHeightStep = {
  id: ReaderLineHeightStepId
  label: string
  value: string
}

export type ReaderPageWidthStep = {
  id: ReaderPageWidthStepId
  label: string
  value: string
}

export const readerFontScaleSteps: ReaderFontScaleStep[] = [
  { id: "xs", label: "小", multiplier: 0.875 },
  { id: "sm", label: "较小", multiplier: 0.9375 },
  { id: "md", label: "标准", multiplier: 1 },
  { id: "lg", label: "较大", multiplier: 1.125 },
  { id: "xl", label: "大", multiplier: 1.25 },
]

export const readerLineHeightSteps: ReaderLineHeightStep[] = [
  { id: "tight", label: "紧凑", value: "1.5" },
  { id: "snug", label: "适中", value: "1.7" },
  { id: "normal", label: "标准", value: "1.9" },
  { id: "relaxed", label: "宽松", value: "2.1" },
]

export const readerPageWidthSteps: ReaderPageWidthStep[] = [
  { id: "narrow", label: "窄", value: "640px" },
  { id: "medium", label: "适中", value: "820px" },
  { id: "wide", label: "宽", value: "1040px" },
]

const fontScaleMap = new Map(readerFontScaleSteps.map((step) => [step.id, step]))
const lineHeightMap = new Map(readerLineHeightSteps.map((step) => [step.id, step]))
const pageWidthMap = new Map(readerPageWidthSteps.map((step) => [step.id, step]))

function normalizeStep<T extends string>(
  value: string | null | undefined,
  known: Map<T, unknown>,
): T | null {
  return value && known.has(value as T) ? (value as T) : null
}

/** 把任意持久化的 JSON 归一为合法的排版覆盖项;无法识别的字段回落为 null。 */
export function normalizeReaderTypographyOverrides(
  raw: unknown,
): ReaderTypographyOverrides {
  if (!raw || typeof raw !== "object") {
    return { ...defaultReaderTypographyOverrides }
  }
  const record = raw as Record<string, unknown>
  return {
    fontScale: normalizeStep(record.fontScale as string, fontScaleMap),
    lineHeight: normalizeStep(record.lineHeight as string, lineHeightMap),
    pageWidth: normalizeStep(record.pageWidth as string, pageWidthMap),
  }
}

export function hasReaderTypographyOverride(overrides: ReaderTypographyOverrides): boolean {
  return (
    overrides.fontScale !== null ||
    overrides.lineHeight !== null ||
    overrides.pageWidth !== null
  )
}

function parseFontSizePx(fontSize: string): number {
  const parsed = Number.parseFloat(fontSize)
  return Number.isFinite(parsed) ? parsed : 16
}

function formatPx(value: number): string {
  // 去掉浮点尾数,避免 17.599999px 之类的脏值。
  return `${Math.round(value * 100) / 100}px`
}

/**
 * 由排版覆盖项生成的 CSS 变量补丁。只包含被用户显式覆盖的变量,
 * 由调用方在主题变量之后展开,从而让用户覆盖优先。
 */
export function readerTypographyStyle(
  overrides: ReaderTypographyOverrides,
  theme: ReaderDisplayTheme,
): ReaderDisplayThemeStyle {
  const style: ReaderDisplayThemeStyle = {}
  if (overrides.fontScale) {
    const multiplier = fontScaleMap.get(overrides.fontScale)?.multiplier ?? 1
    const base = parseFontSizePx(theme.vars.fontSize)
    style["--reader-font-size"] = formatPx(base * multiplier)
  }
  if (overrides.lineHeight) {
    const value = lineHeightMap.get(overrides.lineHeight)?.value
    if (value) {
      style["--reader-line-height"] = value
    }
  }
  if (overrides.pageWidth) {
    const value = pageWidthMap.get(overrides.pageWidth)?.value
    if (value) {
      style["--reader-page-width"] = value
    }
  }
  return style
}
