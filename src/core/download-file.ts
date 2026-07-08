export function downloadMarkdownFile(filename: string, markdown: string) {
  downloadTextFile(filename, markdown, "text/markdown;charset=utf-8")
}

export function downloadTextFile(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
