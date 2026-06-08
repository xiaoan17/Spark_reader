import type { ReaderView } from "./highlight-target-view"

export type ReaderViewCapabilityContext = {
  canShowConvertedText: boolean
  canOpenPdfView: boolean
  hasBook: boolean
  isDesktop: boolean
}

export type ReaderViewConfig = {
  view: ReaderView
  label: string
  headerLabel: string
  title: string
  disabled: boolean
  showsOutline: boolean
  showsInterpretationAside: boolean
  contentClassName: string
}

export const READER_VIEW_ORDER: ReaderView[] = [
  "text",
  "tldr",
  "translation",
  "knowledge",
  "pdf",
]

export function readerViewConfig(
  view: ReaderView,
  context: ReaderViewCapabilityContext,
): ReaderViewConfig {
  const base = baseReaderViewConfig(view)
  const disabled = disabledForReaderView(view, context)
  return {
    ...base,
    disabled,
  }
}

export function readerViewConfigs(context: ReaderViewCapabilityContext): ReaderViewConfig[] {
  return READER_VIEW_ORDER.map((view) => readerViewConfig(view, context))
}

export function readerViewHeaderLabel(view: ReaderView): string {
  return baseReaderViewConfig(view).headerLabel
}

export function readerLayoutColumns(readerView: ReaderView, sidebarOpen: boolean): string {
  const showAside = baseReaderViewConfig(readerView).showsInterpretationAside
  if (sidebarOpen) {
    return showAside ? "240px minmax(640px,1fr) 360px" : "240px minmax(760px,1fr) 0px"
  }
  return showAside ? "0px minmax(640px,1fr) 360px" : "0px minmax(760px,1fr) 0px"
}

function disabledForReaderView(
  view: ReaderView,
  context: ReaderViewCapabilityContext,
): boolean {
  switch (view) {
    case "text":
    case "tldr":
      return !context.canShowConvertedText
    case "translation":
      return !context.canShowConvertedText || !context.hasBook || !context.isDesktop
    case "knowledge":
      return !context.canShowConvertedText || !context.hasBook
    case "pdf":
      return !context.canOpenPdfView
  }
}

function baseReaderViewConfig(view: ReaderView): Omit<ReaderViewConfig, "disabled"> {
  switch (view) {
    case "text":
      return {
        view,
        label: "转换稿",
        headerLabel: "转换稿主视图",
        title: "打开转换稿主视图",
        showsOutline: true,
        showsInterpretationAside: true,
        contentClassName: "min-h-0 overflow-hidden bg-[hsl(38_22%_91%)] animate-fade-in",
      }
    case "tldr":
      return {
        view,
        label: "TLDR",
        headerLabel: "TLDR",
        title: "打开 TLDR 总览",
        showsOutline: false,
        showsInterpretationAside: true,
        contentClassName: "min-h-0 overflow-hidden bg-[hsl(38_22%_91%)] animate-fade-in",
      }
    case "translation":
      return {
        view,
        label: "对照翻译",
        headerLabel: "对照翻译",
        title: "打开左英右中对照翻译视图",
        showsOutline: true,
        showsInterpretationAside: true,
        contentClassName: "min-h-0 overflow-hidden bg-[hsl(38_22%_91%)] animate-fade-in",
      }
    case "knowledge":
      return {
        view,
        label: "知识体系",
        headerLabel: "知识体系",
        title: "打开完整知识体系视图",
        showsOutline: false,
        showsInterpretationAside: false,
        contentClassName: "min-h-0 overflow-hidden bg-[hsl(38_22%_91%)] animate-fade-in",
      }
    case "pdf":
      return {
        view,
        label: "PDF",
        headerLabel: "原 PDF 校对",
        title: "打开原 PDF 校对坐标",
        showsOutline: false,
        showsInterpretationAside: true,
        contentClassName: "min-h-0 overflow-auto bg-[hsl(38_22%_91%)] px-8 py-8 animate-fade-in",
      }
  }
}
