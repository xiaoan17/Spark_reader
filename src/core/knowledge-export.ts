// Pure helpers for the knowledge-book export flow.
//
// Added for the P10 frontend pure-function layer. The Markdown/JSON payloads
// themselves are rendered by the Rust backend; these functions cover the
// frontend-owned concerns — stable file naming, empty-state detection and
// preview truncation — as unit-testable pure functions (no React/Tauri).

/** Slugify a book title for use in a download filename (mirrors safeDownloadName). */
export function sanitizeExportName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80)
  return cleaned || "reading-knowledge"
}

/** Format a Date as YYYYMMDD in local time (stable, locale-independent). */
export function formatExportDateStamp(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}${month}${day}`
}

/**
 * Build a stable export filename, e.g.
 *   knowledgeExportFilename("财富公式", "md", date) -> "财富公式-知识册-20260607.md"
 *   knowledgeExportFilename("财富公式", "json", date) -> "财富公式-knowledge-20260607.json"
 * matching the §8 plan naming convention.
 */
export function knowledgeExportFilename(
  bookTitle: string,
  kind: "md" | "json",
  date: Date,
): string {
  const base = sanitizeExportName(bookTitle)
  const stamp = formatExportDateStamp(date)
  const label = kind === "md" ? "知识册" : "knowledge"
  return `${base}-${label}-${stamp}.${kind}`
}

/** Whether an exported Markdown payload has no real knowledge content. */
export function isExportEmpty(markdown: string | null | undefined): boolean {
  if (!markdown) {
    return true
  }
  const withoutHeadings = markdown
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("")
    .trim()
  // The backend emits a known placeholder sentence for empty books.
  if (markdown.includes("这本书还没有知识卡片")) {
    return true
  }
  return withoutHeadings.length === 0
}

/**
 * Truncate long export content for an in-dialog preview, appending an ellipsis
 * marker when truncated. Returns the original string when within the limit.
 */
export function buildExportPreview(markdown: string, maxChars = 4000): string {
  if (markdown.length <= maxChars) {
    return markdown
  }
  return `${markdown.slice(0, maxChars).trimEnd()}\n\n… (预览已截断，完整内容请保存文件)`
}
