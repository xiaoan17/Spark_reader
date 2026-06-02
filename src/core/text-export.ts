export type TextAssetFormat = "txt" | "md"

export type TextAssetPage = {
  pageIndex?: number
  text: string
  markdown?: string | null
}

export function makeTextAssetFilename(bookTitle: string, format: TextAssetFormat) {
  const safeTitle = bookTitle
    .trim()
    .replace(/\.[^.]+$/u, "")
    .replace(/[\\/:*?"<>|]/gu, "-")
    .replace(/\s+/gu, " ")
    .slice(0, 80)
    .trim()
  return `${safeTitle || "converted-book"}.${format}`
}

export function buildTextAssetContent(pages: TextAssetPage[], format: TextAssetFormat) {
  if (format === "md") {
    return pages
      .map((page, index) => markdownForPage(page, index))
      .filter(Boolean)
      .join("\n\n")
  }

  return pages
    .map((page) => page.text)
    .filter((text) => text.trim().length > 0)
    .join("\n\n")
}

export function downloadTextAsset(
  bookTitle: string,
  format: TextAssetFormat,
  content: string,
) {
  const type = format === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8"
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = makeTextAssetFilename(bookTitle, format)
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function markdownForPage(page: TextAssetPage, fallbackIndex: number) {
  const markdown = page.markdown?.trim()
  if (markdown) {
    return markdown
  }

  const text = page.text.trim()
  if (!text) {
    return ""
  }

  return text
}
