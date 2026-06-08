import { describe, expect, it } from "vitest"
import {
  READER_VIEW_ORDER,
  readerLayoutColumns,
  readerViewConfigs,
  readerViewHeaderLabel,
} from "./reader-view-config"

describe("reader view config", () => {
  it("keeps the product view order stable", () => {
    const configs = readerViewConfigs({
      canShowConvertedText: true,
      canOpenPdfView: true,
      hasBook: true,
      isDesktop: true,
    })

    expect(READER_VIEW_ORDER).toEqual(["text", "tldr", "translation", "knowledge", "pdf"])
    expect(configs.map((config) => config.label)).toEqual([
      "转换稿",
      "TLDR",
      "对照翻译",
      "知识体系",
      "PDF",
    ])
  })

  it("centralizes view capability rules", () => {
    const browserConfigs = readerViewConfigs({
      canShowConvertedText: true,
      canOpenPdfView: false,
      hasBook: true,
      isDesktop: false,
    })

    expect(browserConfigs.find((config) => config.view === "translation")?.disabled).toBe(true)
    expect(browserConfigs.find((config) => config.view === "knowledge")?.disabled).toBe(false)
    expect(browserConfigs.find((config) => config.view === "pdf")?.disabled).toBe(true)
  })

  it("treats knowledge as a full-width top-level workspace", () => {
    const configs = readerViewConfigs({
      canShowConvertedText: true,
      canOpenPdfView: true,
      hasBook: true,
      isDesktop: true,
    })
    const knowledge = configs.find((config) => config.view === "knowledge")

    expect(knowledge?.showsOutline).toBe(false)
    expect(knowledge?.showsInterpretationAside).toBe(false)
    expect(readerLayoutColumns("knowledge", true)).toBe("240px minmax(760px,1fr) 0px")
    expect(readerLayoutColumns("knowledge", false)).toBe("0px minmax(760px,1fr) 0px")
  })

  it("keeps header labels separate from short tab labels", () => {
    expect(readerViewHeaderLabel("text")).toBe("转换稿主视图")
    expect(readerViewHeaderLabel("pdf")).toBe("原 PDF 校对")
  })
})
