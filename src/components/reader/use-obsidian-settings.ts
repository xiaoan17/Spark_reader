import { useEffect, useState } from "react"
import {
  exportBookKnowledgeToObsidian,
  exportSnippetToObsidian,
  getObsidianSettings,
  isTauriRuntime,
  normalizeCommandError,
  saveObsidianSettings,
  type ObsidianSnippet,
} from "@/core/library-api"
import { type ObsidianSettingsStatus } from "@/components/settings/ObsidianSettingsPanel"
import type { NormalizedPageRect } from "@/core/coordinates"
import type { EvidencePreview } from "@/stores/reader-store"
import type { ReaderPanelName } from "./reader-panels"

type UseObsidianSettingsDeps = {
  bookId: string
  interpretation: string
  sparkSelectionText: string
  sparkSelectionRects: NormalizedPageRect[]
  citationChunkIds?: string[]
  evidence: EvidencePreview[]
  pushNotice: (message: string) => void
  setPanelOpen: (panel: ReaderPanelName, open: boolean) => void
}

/**
 * Obsidian 打通：vault 设置的读取/保存，以及把解读、高亮、知识册导出到 Obsidian。
 * 从 ReaderShell 抽出；桌面版才可用，缺配置时引导打开设置面板。
 */
export function useObsidianSettings({
  bookId,
  interpretation,
  sparkSelectionText,
  sparkSelectionRects,
  citationChunkIds,
  evidence,
  pushNotice,
  setPanelOpen,
}: UseObsidianSettingsDeps) {
  const [obsidianVaultPath, setObsidianVaultPath] = useState("")
  const [obsidianSubdir, setObsidianSubdir] = useState("")
  const [obsidianConfigured, setObsidianConfigured] = useState(false)
  const [obsidianStatus, setObsidianStatus] = useState<ObsidianSettingsStatus>("idle")
  const [obsidianMessage, setObsidianMessage] = useState("")
  const [sparkObsidianExporting, setSparkObsidianExporting] = useState(false)
  const [knowledgeObsidianExporting, setKnowledgeObsidianExporting] = useState(false)

  useEffect(() => {
    void refreshObsidianSettings()
  }, [])

  async function refreshObsidianSettings() {
    if (!isTauriRuntime()) {
      return
    }
    setObsidianStatus("loading")
    try {
      const settings = await getObsidianSettings()
      setObsidianVaultPath(settings.vaultPath)
      setObsidianSubdir(settings.subdir)
      setObsidianConfigured(settings.configured)
      setObsidianStatus("idle")
      setObsidianMessage("")
    } catch (error) {
      setObsidianStatus("error")
      setObsidianMessage(normalizeCommandError(error).message)
    }
  }

  async function handleSaveObsidianSettings() {
    if (!isTauriRuntime()) {
      setObsidianStatus("error")
      setObsidianMessage("Obsidian 导出需要桌面版。")
      return
    }
    setObsidianStatus("saving")
    setObsidianMessage("")
    try {
      const settings = await saveObsidianSettings({
        vaultPath: obsidianVaultPath.trim(),
        subdir: obsidianSubdir.trim() || null,
      })
      setObsidianVaultPath(settings.vaultPath)
      setObsidianSubdir(settings.subdir)
      setObsidianConfigured(settings.configured)
      setObsidianStatus("ok")
      setObsidianMessage(settings.configured ? "Obsidian 设置已保存" : "已清除 Obsidian 配置")
    } catch (error) {
      setObsidianStatus("error")
      setObsidianMessage(normalizeCommandError(error).message)
    }
  }

  function obsidianTimestamp() {
    const now = new Date()
    const pad = (value: number) => String(value).padStart(2, "0")
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  }

  async function handleExportSparkToObsidian() {
    if (!bookId) {
      pushNotice("请先打开一本书")
      return
    }
    if (!interpretation.trim()) {
      pushNotice("还没有可导出的解读内容")
      return
    }
    if (!obsidianConfigured) {
      pushNotice("请先配置 Obsidian vault")
      setPanelOpen("obsidianSettingsOpen", true)
      return
    }
    const pageIndex = sparkSelectionRects[0]?.pageIndex ?? null
    const snippet: ObsidianSnippet = {
      kind: "spark",
      pageNumber: pageIndex === null ? null : pageIndex + 1,
      quote: sparkSelectionText.trim() || null,
      content: interpretation,
      chunkIds:
        citationChunkIds && citationChunkIds.length > 0
          ? citationChunkIds
          : evidence.map((item) => item.chunkId),
      timestamp: obsidianTimestamp(),
    }
    setSparkObsidianExporting(true)
    try {
      await exportSnippetToObsidian(bookId, snippet)
      pushNotice("已存到 Obsidian")
    } catch (error) {
      pushNotice(`存到 Obsidian 失败；${normalizeCommandError(error).message}`)
    } finally {
      setSparkObsidianExporting(false)
    }
  }

  async function handleExportHighlightToObsidian() {
    const quote = sparkSelectionText.trim()
    if (!bookId) {
      pushNotice("请先打开一本书")
      return
    }
    if (!quote) {
      pushNotice("请先框选一段文字")
      return
    }
    if (!obsidianConfigured) {
      pushNotice("请先配置 Obsidian vault")
      setPanelOpen("obsidianSettingsOpen", true)
      return
    }
    const pageIndex = sparkSelectionRects[0]?.pageIndex ?? null
    const snippet: ObsidianSnippet = {
      kind: "highlight",
      pageNumber: pageIndex === null ? null : pageIndex + 1,
      quote,
      content: quote,
      chunkIds: [],
      timestamp: obsidianTimestamp(),
    }
    setSparkObsidianExporting(true)
    try {
      await exportSnippetToObsidian(bookId, snippet)
      pushNotice("高亮已存到 Obsidian")
    } catch (error) {
      pushNotice(`存到 Obsidian 失败；${normalizeCommandError(error).message}`)
    } finally {
      setSparkObsidianExporting(false)
    }
  }

  async function handleExportKnowledgeToObsidian() {
    if (!bookId) {
      pushNotice("请先打开一本书")
      return
    }
    if (!obsidianConfigured) {
      pushNotice("请先配置 Obsidian vault")
      setPanelOpen("obsidianSettingsOpen", true)
      return
    }
    setKnowledgeObsidianExporting(true)
    try {
      await exportBookKnowledgeToObsidian(bookId)
      pushNotice("知识册已导出到 Obsidian")
    } catch (error) {
      pushNotice(`导出到 Obsidian 失败；${normalizeCommandError(error).message}`)
    } finally {
      setKnowledgeObsidianExporting(false)
    }
  }

  return {
    obsidianVaultPath,
    obsidianSubdir,
    obsidianConfigured,
    obsidianStatus,
    obsidianMessage,
    sparkObsidianExporting,
    knowledgeObsidianExporting,
    setObsidianVaultPath,
    setObsidianSubdir,
    handleSaveObsidianSettings,
    handleExportSparkToObsidian,
    handleExportHighlightToObsidian,
    handleExportKnowledgeToObsidian,
  }
}
