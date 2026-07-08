import type { CSSProperties } from "react"
import type { ReaderResolvedColorMode } from "./reader-color-mode"

export type ReaderDisplayThemeId =
  | "spark-paper"
  | "typora-github"
  | "typora-newsprint"
  | "typora-night"
  | "typora-pixyll"
  | "typora-gothic"
  | "typora-whitey"

export type ReaderDisplayTheme = {
  id: ReaderDisplayThemeId
  label: string
  sourceName: string
  description: string
  vars: ReaderDisplayThemeVars
  /** 暗色变体:只覆盖配色 token,排版 token(字号/行距/页宽/字体)保持不变。 */
  darkVars: ReaderDisplayThemeColorVars
}

export type ReaderDisplayThemeStyle = CSSProperties & {
  [key: `--reader-${string}`]: string
}

/** 会随明暗切换的配色 token。 */
type ReaderDisplayThemeColorVars = {
  shellBg: string
  surfaceBg: string
  text: string
  muted: string
  border: string
  link: string
  quoteBorder: string
  codeBg: string
  workspaceBg: string
  chromeBg: string
  chromeText: string
  chromeMuted: string
  panelBg: string
  panelText: string
  panelMuted: string
  panelBorder: string
  panelHoverBg: string
  panelActiveBg: string
  panelActiveText: string
  floatingBg: string
  floatingText: string
  floatingBorder: string
}

/** 与明暗无关的排版 token。 */
type ReaderDisplayThemeTypographyVars = {
  bodyFont: string
  headingFont: string
  fontSize: string
  lineHeight: string
  pageWidth: string
  paragraphMargin: string
  textAlign: "start" | "justify"
  h1Size: string
  h2Size: string
  h3Size: string
}

type ReaderDisplayThemeVars = ReaderDisplayThemeColorVars & ReaderDisplayThemeTypographyVars

export const READER_DISPLAY_THEME_STORAGE_KEY = "focused-reading.reader-display-theme.v1"

export const readerDisplayThemeOptions: ReaderDisplayTheme[] = [
  {
    id: "spark-paper",
    label: "Spark 纸感",
    sourceName: "current",
    description: "当前阅读器的暖纸底和中文长读排版。",
    vars: {
      shellBg: "hsl(38 22% 91%)",
      surfaceBg: "hsl(42 38% 98%)",
      text: "hsl(34 18% 13%)",
      muted: "hsl(34 10% 42%)",
      border: "hsl(34 16% 78%)",
      link: "hsl(178 42% 28%)",
      quoteBorder: "hsl(178 34% 38%)",
      codeBg: "hsl(38 24% 92%)",
      bodyFont: `"Songti SC", "STSong", "Noto Serif CJK SC", serif`,
      headingFont: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
      fontSize: "16px",
      lineHeight: "2",
      pageWidth: "760px",
      paragraphMargin: "1em 0",
      textAlign: "start",
      h1Size: "1.55em",
      h2Size: "1.32em",
      h3Size: "1.12em",
      workspaceBg: "hsl(38 22% 91%)",
      chromeBg: "hsl(42 34% 97%)",
      chromeText: "hsl(220 18% 13%)",
      chromeMuted: "hsl(220 9% 42%)",
      panelBg: "hsl(42 30% 96%)",
      panelText: "hsl(220 18% 14%)",
      panelMuted: "hsl(220 9% 48%)",
      panelBorder: "hsl(36 16% 82%)",
      panelHoverBg: "hsl(38 18% 88%)",
      panelActiveBg: "hsl(170 18% 88%)",
      panelActiveText: "hsl(178 42% 28%)",
      floatingBg: "hsl(42 34% 98%)",
      floatingText: "hsl(220 18% 13%)",
      floatingBorder: "hsl(36 16% 80%)",
    },
    darkVars: {
      shellBg: "hsl(34 12% 12%)",
      surfaceBg: "hsl(34 12% 15%)",
      text: "hsl(38 16% 86%)",
      muted: "hsl(34 8% 60%)",
      border: "hsl(34 10% 28%)",
      link: "hsl(174 46% 58%)",
      quoteBorder: "hsl(174 34% 46%)",
      codeBg: "hsl(34 10% 20%)",
      workspaceBg: "hsl(34 12% 10%)",
      chromeBg: "hsl(34 12% 14%)",
      chromeText: "hsl(38 16% 88%)",
      chromeMuted: "hsl(34 8% 62%)",
      panelBg: "hsl(34 12% 15%)",
      panelText: "hsl(38 16% 88%)",
      panelMuted: "hsl(34 8% 62%)",
      panelBorder: "hsl(34 10% 26%)",
      panelHoverBg: "hsl(34 10% 20%)",
      panelActiveBg: "hsl(174 22% 22%)",
      panelActiveText: "hsl(174 46% 64%)",
      floatingBg: "hsl(34 12% 16%)",
      floatingText: "hsl(38 16% 88%)",
      floatingBorder: "hsl(34 10% 30%)",
    },
  },
  {
    id: "typora-github",
    label: "GitHub",
    sourceName: "github.css",
    description: "Open Sans、宽版白底，适合论文和技术资料。",
    vars: {
      shellBg: "#f6f8fa",
      surfaceBg: "#ffffff",
      text: "#333333",
      muted: "#6a737d",
      border: "#e1e4e8",
      link: "#4183c4",
      quoteBorder: "#dfe2e5",
      codeBg: "#f3f4f6",
      bodyFont: `"Open Sans", "Clear Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`,
      headingFont: `"Open Sans", "Clear Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`,
      fontSize: "16px",
      lineHeight: "1.72",
      pageWidth: "860px",
      paragraphMargin: "0.8em 0",
      textAlign: "start",
      h1Size: "2.1em",
      h2Size: "1.62em",
      h3Size: "1.38em",
      workspaceBg: "#f6f8fa",
      chromeBg: "#ffffff",
      chromeText: "#24292f",
      chromeMuted: "#57606a",
      panelBg: "#ffffff",
      panelText: "#24292f",
      panelMuted: "#6e7781",
      panelBorder: "#d0d7de",
      panelHoverBg: "#f3f4f6",
      panelActiveBg: "#ddf4ff",
      panelActiveText: "#0969da",
      floatingBg: "#ffffff",
      floatingText: "#24292f",
      floatingBorder: "#d0d7de",
    },
    darkVars: {
      shellBg: "#0d1117",
      surfaceBg: "#0d1117",
      text: "#c9d1d9",
      muted: "#8b949e",
      border: "#30363d",
      link: "#58a6ff",
      quoteBorder: "#3b434b",
      codeBg: "#161b22",
      workspaceBg: "#010409",
      chromeBg: "#161b22",
      chromeText: "#c9d1d9",
      chromeMuted: "#8b949e",
      panelBg: "#161b22",
      panelText: "#c9d1d9",
      panelMuted: "#8b949e",
      panelBorder: "#30363d",
      panelHoverBg: "#21262d",
      panelActiveBg: "#1f2d3d",
      panelActiveText: "#58a6ff",
      floatingBg: "#1c2128",
      floatingText: "#c9d1d9",
      floatingBorder: "#30363d",
    },
  },
  {
    id: "typora-newsprint",
    label: "Newsprint",
    sourceName: "newsprint.css",
    description: "PT Serif、窄栏旧报纸感，适合连续精读。",
    vars: {
      shellBg: "#f3f2ee",
      surfaceBg: "#f3f2ee",
      text: "#1f0909",
      muted: "#5b4a44",
      border: "#cfc8bd",
      link: "#065588",
      quoteBorder: "#9a8f82",
      codeBg: "#ebe7dd",
      bodyFont: `"PT Serif", "Times New Roman", "Songti SC", serif`,
      headingFont: `"PT Serif", "Times New Roman", "Songti SC", serif`,
      fontSize: "16px",
      lineHeight: "1.78",
      pageWidth: "720px",
      paragraphMargin: "0 0 1.5em",
      textAlign: "start",
      h1Size: "1.88em",
      h2Size: "1.32em",
      h3Size: "1.2em",
      workspaceBg: "#f3f2ee",
      chromeBg: "#eeeae1",
      chromeText: "#2f1b16",
      chromeMuted: "#6b5f58",
      panelBg: "#eeeae1",
      panelText: "#2f1b16",
      panelMuted: "#7a6d62",
      panelBorder: "#cfc8bd",
      panelHoverBg: "#e5dfd2",
      panelActiveBg: "#dbe4dc",
      panelActiveText: "#2f6d66",
      floatingBg: "#f8f5ed",
      floatingText: "#2f1b16",
      floatingBorder: "#c8beb0",
    },
    darkVars: {
      shellBg: "#1c1a17",
      surfaceBg: "#1c1a17",
      text: "#ddd6cc",
      muted: "#a99f92",
      border: "#3a352d",
      link: "#5aa9e0",
      quoteBorder: "#6b6154",
      codeBg: "#24211c",
      workspaceBg: "#16140f",
      chromeBg: "#232019",
      chromeText: "#ddd6cc",
      chromeMuted: "#a99f92",
      panelBg: "#232019",
      panelText: "#ddd6cc",
      panelMuted: "#a99f92",
      panelBorder: "#3a352d",
      panelHoverBg: "#2b271f",
      panelActiveBg: "#26332e",
      panelActiveText: "#7cc0a8",
      floatingBg: "#24211a",
      floatingText: "#ddd6cc",
      floatingBorder: "#423c32",
    },
  },
  {
    id: "typora-night",
    label: "Night",
    sourceName: "night.css",
    description: "Typora 夜读灰蓝底，不依赖全局深色模式。",
    vars: {
      shellBg: "#363b40",
      surfaceBg: "#363b40",
      text: "#b8bfc6",
      muted: "#929aa2",
      border: "#555d66",
      link: "#a3d5fe",
      quoteBorder: "#6dc1e7",
      codeBg: "#2e3033",
      bodyFont: `"Helvetica Neue", Helvetica, Arial, sans-serif`,
      headingFont: `"Lucida Grande", Corbel, "Helvetica Neue", sans-serif`,
      fontSize: "16px",
      lineHeight: "1.75",
      pageWidth: "914px",
      paragraphMargin: "0 0 1.5rem",
      textAlign: "start",
      h1Size: "2.25em",
      h2Size: "1.56em",
      h3Size: "1.18em",
      workspaceBg: "#2f3439",
      chromeBg: "#2e3033",
      chromeText: "#d5dbe1",
      chromeMuted: "#9aa3ad",
      panelBg: "#2e3033",
      panelText: "#d5dbe1",
      panelMuted: "#98a1aa",
      panelBorder: "#4a5158",
      panelHoverBg: "#3b4148",
      panelActiveBg: "#344955",
      panelActiveText: "#9ed8f5",
      floatingBg: "#33383e",
      floatingText: "#d5dbe1",
      floatingBorder: "#626b75",
    },
    // Night 本身即暗色主题,暗色变体就是自身配色。
    darkVars: {
      shellBg: "#363b40",
      surfaceBg: "#363b40",
      text: "#b8bfc6",
      muted: "#929aa2",
      border: "#555d66",
      link: "#a3d5fe",
      quoteBorder: "#6dc1e7",
      codeBg: "#2e3033",
      workspaceBg: "#2f3439",
      chromeBg: "#2e3033",
      chromeText: "#d5dbe1",
      chromeMuted: "#9aa3ad",
      panelBg: "#2e3033",
      panelText: "#d5dbe1",
      panelMuted: "#98a1aa",
      panelBorder: "#4a5158",
      panelHoverBg: "#3b4148",
      panelActiveBg: "#344955",
      panelActiveText: "#9ed8f5",
      floatingBg: "#33383e",
      floatingText: "#d5dbe1",
      floatingBorder: "#626b75",
    },
  },
  {
    id: "typora-pixyll",
    label: "Pixyll",
    sourceName: "pixyll.css",
    description: "Merriweather 正文和 Lato 标题，偏博客长文。",
    vars: {
      shellBg: "#f7f7f7",
      surfaceBg: "#ffffff",
      text: "#333333",
      muted: "#666666",
      border: "#333333",
      link: "#0076df",
      quoteBorder: "#333333",
      codeBg: "#f0f0f0",
      bodyFont: `"Merriweather", "PT Serif", Georgia, "Times New Roman", "Songti SC", serif`,
      headingFont: `"Lato", "Helvetica Neue", Helvetica, Arial, sans-serif`,
      fontSize: "18px",
      lineHeight: "1.7",
      pageWidth: "914px",
      paragraphMargin: "0 0 1.5rem",
      textAlign: "start",
      h1Size: "1.78em",
      h2Size: "1.42em",
      h3Size: "1.2em",
      workspaceBg: "#f7f7f7",
      chromeBg: "#ffffff",
      chromeText: "#333333",
      chromeMuted: "#666666",
      panelBg: "#ffffff",
      panelText: "#333333",
      panelMuted: "#666666",
      panelBorder: "#dedede",
      panelHoverBg: "#f0f0f0",
      panelActiveBg: "#eef5fb",
      panelActiveText: "#0076df",
      floatingBg: "#ffffff",
      floatingText: "#333333",
      floatingBorder: "#d6d6d6",
    },
    darkVars: {
      shellBg: "#1a1a1a",
      surfaceBg: "#1e1e1e",
      text: "#d4d4d4",
      muted: "#9a9a9a",
      border: "#3a3a3a",
      link: "#4a9eff",
      quoteBorder: "#555555",
      codeBg: "#262626",
      workspaceBg: "#141414",
      chromeBg: "#1e1e1e",
      chromeText: "#d4d4d4",
      chromeMuted: "#9a9a9a",
      panelBg: "#1e1e1e",
      panelText: "#d4d4d4",
      panelMuted: "#9a9a9a",
      panelBorder: "#3a3a3a",
      panelHoverBg: "#2a2a2a",
      panelActiveBg: "#1c3049",
      panelActiveText: "#4a9eff",
      floatingBg: "#222222",
      floatingText: "#d4d4d4",
      floatingBorder: "#3d3d3d",
    },
  },
  {
    id: "typora-gothic",
    label: "Gothic",
    sourceName: "gothic.css",
    description: "几何无衬线、居中标题，适合简洁手册。",
    vars: {
      shellBg: "#fcfcfc",
      surfaceBg: "#fcfcfc",
      text: "#111111",
      muted: "#606060",
      border: "#dddddd",
      link: "#2484c1",
      quoteBorder: "#dddddd",
      codeBg: "#f4f4f4",
      bodyFont: `"TeXGyreAdventor", "Century Gothic", "Didact Gothic", "Yu Gothic", sans-serif`,
      headingFont: `"TeXGyreAdventor", "Century Gothic", "Didact Gothic", "Yu Gothic", sans-serif`,
      fontSize: "16px",
      lineHeight: "1.75",
      pageWidth: "914px",
      paragraphMargin: "0 0 1.25rem",
      textAlign: "justify",
      h1Size: "2em",
      h2Size: "1.55em",
      h3Size: "1.25em",
      workspaceBg: "#fcfcfc",
      chromeBg: "#ffffff",
      chromeText: "#111111",
      chromeMuted: "#606060",
      panelBg: "#ffffff",
      panelText: "#111111",
      panelMuted: "#686868",
      panelBorder: "#dddddd",
      panelHoverBg: "#f3f3f3",
      panelActiveBg: "#eeeeee",
      panelActiveText: "#111111",
      floatingBg: "#ffffff",
      floatingText: "#111111",
      floatingBorder: "#dddddd",
    },
    darkVars: {
      shellBg: "#17181a",
      surfaceBg: "#17181a",
      text: "#d8dade",
      muted: "#9298a0",
      border: "#33363b",
      link: "#5ab0e8",
      quoteBorder: "#40444a",
      codeBg: "#202225",
      workspaceBg: "#111214",
      chromeBg: "#1d1f22",
      chromeText: "#d8dade",
      chromeMuted: "#9298a0",
      panelBg: "#1d1f22",
      panelText: "#d8dade",
      panelMuted: "#9298a0",
      panelBorder: "#33363b",
      panelHoverBg: "#26292d",
      panelActiveBg: "#2a2d31",
      panelActiveText: "#e4e6ea",
      floatingBg: "#1f2225",
      floatingText: "#d8dade",
      floatingBorder: "#35383d",
    },
  },
  {
    id: "typora-whitey",
    label: "Whitey",
    sourceName: "whitey.css",
    description: "Palatino/Vollkorn 风格白纸，适合英文书稿。",
    vars: {
      shellBg: "#f2f2f0",
      surfaceBg: "#fefefe",
      text: "#333333",
      muted: "#666666",
      border: "#dddddd",
      link: "#2484c1",
      quoteBorder: "#dddddd",
      codeBg: "#ffffff",
      bodyFont: `"Vollkorn", Palatino, "Times New Roman", "Songti SC", serif`,
      headingFont: `"Vollkorn", Palatino, "Times New Roman", "Songti SC", serif`,
      fontSize: "17px",
      lineHeight: "1.64",
      pageWidth: "960px",
      paragraphMargin: "0 0 1rem",
      textAlign: "justify",
      h1Size: "2.6em",
      h2Size: "1.65em",
      h3Size: "1.25em",
      workspaceBg: "#f2f2f0",
      chromeBg: "#fefefe",
      chromeText: "#333333",
      chromeMuted: "#666666",
      panelBg: "#fefefe",
      panelText: "#333333",
      panelMuted: "#6d6d6d",
      panelBorder: "#dddddd",
      panelHoverBg: "#f3f2ee",
      panelActiveBg: "#eef4f7",
      panelActiveText: "#2484c1",
      floatingBg: "#fefefe",
      floatingText: "#333333",
      floatingBorder: "#dddddd",
    },
    darkVars: {
      shellBg: "#1b1a18",
      surfaceBg: "#1f1e1b",
      text: "#ddd8cf",
      muted: "#a29b8f",
      border: "#38352f",
      link: "#6fb8e0",
      quoteBorder: "#45413a",
      codeBg: "#26241f",
      workspaceBg: "#151412",
      chromeBg: "#1f1e1b",
      chromeText: "#ddd8cf",
      chromeMuted: "#a29b8f",
      panelBg: "#1f1e1b",
      panelText: "#ddd8cf",
      panelMuted: "#a29b8f",
      panelBorder: "#38352f",
      panelHoverBg: "#292620",
      panelActiveBg: "#26333a",
      panelActiveText: "#6fb8e0",
      floatingBg: "#211f1b",
      floatingText: "#ddd8cf",
      floatingBorder: "#403c34",
    },
  },
]

const readerDisplayThemeMap = new Map(
  readerDisplayThemeOptions.map((theme) => [theme.id, theme]),
)

export function readerDisplayThemeById(id: string | null | undefined): ReaderDisplayTheme {
  return readerDisplayThemeMap.get(normalizeReaderDisplayThemeId(id)) ?? readerDisplayThemeOptions[0]
}

export function normalizeReaderDisplayThemeId(
  id: string | null | undefined,
): ReaderDisplayThemeId {
  return readerDisplayThemeMap.has(id as ReaderDisplayThemeId)
    ? (id as ReaderDisplayThemeId)
    : "spark-paper"
}

export function readerDisplayThemeStyle(
  id: ReaderDisplayThemeId,
  mode: ReaderResolvedColorMode = "light",
): ReaderDisplayThemeStyle {
  const base = readerDisplayThemeById(id).vars
  // 暗色只覆盖配色 token,排版 token 从亮色变体沿用,保证明暗切换不改变字号/行距/页宽。
  const theme = mode === "dark" ? { ...base, ...readerDisplayThemeById(id).darkVars } : base
  return {
    "--reader-shell-bg": theme.shellBg,
    "--reader-surface-bg": theme.surfaceBg,
    "--reader-text": theme.text,
    "--reader-muted": theme.muted,
    "--reader-border": theme.border,
    "--reader-link": theme.link,
    "--reader-quote-border": theme.quoteBorder,
    "--reader-code-bg": theme.codeBg,
    "--reader-body-font": theme.bodyFont,
    "--reader-heading-font": theme.headingFont,
    "--reader-font-size": theme.fontSize,
    "--reader-line-height": theme.lineHeight,
    "--reader-page-width": theme.pageWidth,
    "--reader-paragraph-margin": theme.paragraphMargin,
    "--reader-text-align": theme.textAlign,
    "--reader-h1-size": theme.h1Size,
    "--reader-h2-size": theme.h2Size,
    "--reader-h3-size": theme.h3Size,
    "--reader-workspace-bg": theme.workspaceBg,
    "--reader-chrome-bg": theme.chromeBg,
    "--reader-chrome-text": theme.chromeText,
    "--reader-chrome-muted": theme.chromeMuted,
    "--reader-panel-bg": theme.panelBg,
    "--reader-panel-text": theme.panelText,
    "--reader-panel-muted": theme.panelMuted,
    "--reader-panel-border": theme.panelBorder,
    "--reader-panel-hover-bg": theme.panelHoverBg,
    "--reader-panel-active-bg": theme.panelActiveBg,
    "--reader-panel-active-text": theme.panelActiveText,
    "--reader-floating-bg": theme.floatingBg,
    "--reader-floating-text": theme.floatingText,
    "--reader-floating-border": theme.floatingBorder,
  }
}
