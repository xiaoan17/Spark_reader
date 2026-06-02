export type AlignedTranslationRow = {
  index: number
  sourceMarkdown: string
  translatedMarkdown: string
}

type TranslationBlock = {
  id: string
  markdown: string
}

export function alignedTranslationRows(
  sourceMarkdown: string,
  translatedMarkdown: string,
): AlignedTranslationRow[] {
  const sourceBlocks = sourceTranslationBlocks(sourceMarkdown)
  const numberedTranslatedBlocks = splitNumberedTranslationBlocks(translatedMarkdown)

  if (numberedTranslatedBlocks.length > 0) {
    const sourceIds = new Set(sourceBlocks.map((block) => block.id))
    const translatedById = new Map(
      numberedTranslatedBlocks.map((block) => [block.id, block.markdown]),
    )
    const rows = sourceBlocks.map((sourceBlock, index) => ({
      index,
      sourceMarkdown: sourceBlock.markdown,
      translatedMarkdown: translatedById.get(sourceBlock.id) ?? "",
    }))
    for (const block of numberedTranslatedBlocks) {
      if (sourceIds.has(block.id) || !block.markdown.trim()) {
        continue
      }
      rows.push({
        index: rows.length,
        sourceMarkdown: "",
        translatedMarkdown: block.markdown,
      })
    }
    if (rows.length > 0) {
      return rows
    }
  }

  const sourceMarkdownBlocks = sourceBlocks.map((block) => block.markdown)
  const translatedBlocks = splitMarkdownBlocks(translatedMarkdown)
  const rowCount = Math.max(sourceMarkdownBlocks.length, translatedBlocks.length, 1)

  return Array.from({ length: rowCount }, (_, index) => ({
    index,
    sourceMarkdown: sourceMarkdownBlocks[index] ?? "",
    translatedMarkdown: translatedBlocks[index] ?? "",
  }))
}

export function sanitizeDisplayedTranslationMarkdown(markdown: string, sourceMarkdown: string) {
  const sourceBlocks = splitMarkdownBlocks(sourceMarkdown)
  const sourceEchoes = new Set(
    sourceBlocks.map(normalizedBlockText).filter((block) => block.length >= 24),
  )
  const strippedMarkdown = markdown
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/```\s*$/i, "")
  const numberedBlocks = splitNumberedTranslationBlocks(strippedMarkdown)
  if (numberedBlocks.length > 0) {
    return numberedBlocks
      .map((block) => {
        const cleaned = sanitizeNumberedTranslationBlock(block.markdown)
        return `[[${block.id}]]${cleaned ? `\n${cleaned}` : ""}`
      })
      .join("\n\n")
      .trim()
  }

  const blocks = splitMarkdownBlocks(strippedMarkdown)
  const cleanedBlocks = []

  for (const block of blocks) {
    if (isTranslationBoilerplateBlock(block)) {
      continue
    }
    if (isTranslationNotesBlock(block)) {
      break
    }
    if (isLongSourceEchoBlock(block, sourceEchoes)) {
      continue
    }
    cleanedBlocks.push(block)
  }

  return cleanedBlocks.join("\n\n").trim()
}

function sourceTranslationBlocks(sourceMarkdown: string): TranslationBlock[] {
  return splitMarkdownBlocks(sourceMarkdown).map((block, index) => ({
    id: translationBlockId(index),
    markdown: block,
  }))
}

function translationBlockId(index: number) {
  return `B${String(index + 1).padStart(3, "0")}`
}

export function splitMarkdownBlocks(markdown: string) {
  const normalized = markdown.replace(/\r\n/g, "\n").trim()
  if (!normalized) {
    return []
  }
  return normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
}

function splitNumberedTranslationBlocks(markdown: string): TranslationBlock[] {
  const normalized = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
  if (!normalized) {
    return []
  }
  const blocks: TranslationBlock[] = []
  let currentId = ""
  let currentLines: string[] = []
  const flush = () => {
    if (!currentId) {
      currentLines = []
      return
    }
    blocks.push({
      id: currentId,
      markdown: currentLines.join("\n").trim(),
    })
    currentId = ""
    currentLines = []
  }

  for (const line of normalized.split("\n")) {
    const marker = line.match(/^\s*(?:[-*]\s*)?\[\[B(\d+)\]\]\s*(.*)$/i)
    if (marker) {
      flush()
      currentId = `B${String(Number(marker[1])).padStart(3, "0")}`
      const rest = marker[2]?.trimEnd()
      currentLines = rest ? [rest] : []
    } else if (currentId) {
      currentLines.push(line)
    }
  }
  flush()
  return blocks
}

function sanitizeNumberedTranslationBlock(block: string) {
  const text = block.trim()
  if (isTranslationBoilerplateBlock(text) || isTranslationNotesBlock(text)) {
    return ""
  }
  return text
}

function isTranslationBoilerplateBlock(block: string) {
  const text = normalizedBlockText(block)
  return (
    /^(中文译文|已完成|译文)$/.test(text) ||
    /^以下是.*中文翻译/.test(text) ||
    /^下面是.*中文翻译/.test(text) ||
    /^Here is the Chinese translation/i.test(text)
  )
}

function isTranslationNotesBlock(block: string) {
  const text = normalizedBlockText(block)
  return /^(翻译说明|译者说明|说明)[:：]?/.test(text)
}

function isLongSourceEchoBlock(block: string, sourceEchoes: ReadonlySet<string>) {
  const text = normalizedBlockText(block)
  if (text.length < 24 || !sourceEchoes.has(text)) {
    return false
  }
  const cjkCount = (text.match(/[\u3400-\u9fff]/g) ?? []).length
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length
  return cjkCount === 0 && latinCount >= 12
}

function normalizedBlockText(block: string) {
  return block
    .replace(/[`*_>#\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}
