// Pure display/formatting rules for the knowledge layer.
//
// Extracted from KnowledgePanel.tsx (P10 frontend pure-function layer) so the
// label/status/source/confidence/drift presentation logic is unit-testable in
// isolation and shared consistently across components.
//
// These functions are intentionally free of React and Tauri imports.

/**
 * Canonical knowledge card types, in the order they should appear in pickers.
 * Single source of truth for the edit-form `<select>` and label lookups.
 */
export const KNOWLEDGE_CARD_TYPES = [
  "note",
  "highlight",
  "interpretation",
  "concept",
  "entity",
  "event",
  "claim",
  "question",
  "summary",
  "chapter_outline",
  "knowledge_deck",
  "agent_report",
] as const

export type KnowledgeCardType = (typeof KNOWLEDGE_CARD_TYPES)[number]

const CARD_TYPE_LABELS: Record<string, string> = {
  highlight: "高亮",
  interpretation: "解读",
  question: "追问",
  note: "笔记",
  concept: "概念",
  entity: "实体",
  event: "事件",
  claim: "论点",
  summary: "章节",
  chapter_outline: "章节大纲",
  knowledge_deck: "知识册",
  agent_report: "任务报告",
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: "已确认",
  candidate: "候选",
  rejected: "已拒绝",
}

const SOURCE_LABELS: Record<string, string> = {
  user: "用户",
  highlight: "高亮",
  interpretation: "解读",
  auto: "自动",
  llm: "AI",
  reflected: "反思",
}

/** Human-facing label for a card type; falls back to the raw value, then "卡片". */
export function labelForCardType(value: string): string {
  return CARD_TYPE_LABELS[value] ?? (value || "卡片")
}

/** Human-facing label for a card status; falls back to the raw value, then "未知". */
export function labelForStatus(value: string): string {
  return STATUS_LABELS[value] ?? (value || "未知")
}

/** Human-facing label for a card source; falls back to the raw value, then "未知". */
export function labelForSource(value: string): string {
  return SOURCE_LABELS[value] ?? (value || "未知")
}

/**
 * Format a 0..1 confidence as an integer percent string (e.g. 0.42 -> "42%").
 * Values outside [0, 1] are clamped so the UI never shows e.g. "-10%" or "180%".
 */
export function formatConfidencePercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "—"
  }
  const clamped = Math.min(1, Math.max(0, value))
  return `${Math.round(clamped * 100)}%`
}

/**
 * Whether a card should be visually flagged as low-confidence (and therefore
 * shown as a candidate, not a fact). Confirmed cards are never low-confidence.
 */
export function isLowConfidence(card: { status: string; confidence: number }): boolean {
  if (card.status === "confirmed") {
    return false
  }
  return card.confidence < 0.5
}

/**
 * Citation-drift notice for a card given how many of its evidence chunks have
 * drifted. Returns null when there is nothing to warn about.
 */
export function driftNotice(driftCount: number): string | null {
  if (!Number.isFinite(driftCount) || driftCount <= 0) {
    return null
  }
  return `原文已重解析，${driftCount} 条引用需要复核。`
}

/** Compact health summary line: "已确认 X / 候选 Y / 漂移 Z". */
export function formatHealthSummary(health: {
  confirmedCount: number
  candidateCount: number
  driftCount: number
}): string {
  return `已确认 ${health.confirmedCount} / 候选 ${health.candidateCount} / 漂移 ${health.driftCount}`
}
