export const legacyChunkIdPattern = /^p\d+-c\d+$/i
export const namespacedChunkIdPattern = /^b[0-9a-f]{8}-p\d+-c\d+-[0-9a-f]{8}$/i

export function bookNamespace(seed: string) {
  return `b${hashString(seed)}`
}

export function makeChunkId(bookSeed: string, pageIndex: number, chunkIndex: number, text: string) {
  const namespace = bookSeed.startsWith("b") && /^b[0-9a-f]{8}$/i.test(bookSeed)
    ? bookSeed.toLowerCase()
    : bookNamespace(bookSeed)
  return `${namespace}-p${pageIndex + 1}-c${chunkIndex + 1}-${hashString(normalizeForHash(text))}`
}

export function isNamespacedChunkId(value: string) {
  return namespacedChunkIdPattern.test(value)
}

export function isLegacyChunkId(value: string) {
  return legacyChunkIdPattern.test(value)
}

export function rewriteChunkMarkdown(markdown: string, oldChunkId: string, newChunkId: string) {
  return markdown.replaceAll(`[${oldChunkId}]`, `[${newChunkId}]`)
}

export function normalizeParsedChunkIds<T extends { chunkId: string; pageIndex: number; text: string; markdown: string }>(
  bookSeed: string,
  chunks: T[],
): T[] {
  const namespace = bookNamespace(bookSeed)
  const pageCounts = new Map<number, number>()
  return chunks.map((chunk) => {
    const chunkIndex = pageCounts.get(chunk.pageIndex) ?? 0
    pageCounts.set(chunk.pageIndex, chunkIndex + 1)
    if (isNamespacedChunkId(chunk.chunkId) && chunk.chunkId.toLowerCase().startsWith(`${namespace}-`)) {
      return chunk
    }
    const nextChunkId = makeChunkId(namespace, chunk.pageIndex, chunkIndex, chunk.text)
    return {
      ...chunk,
      chunkId: nextChunkId,
      markdown: rewriteChunkMarkdown(chunk.markdown, chunk.chunkId, nextChunkId),
    }
  })
}

function normalizeForHash(text: string) {
  return text.trim().split(/\s+/).join(" ")
}

export function hashString(input: string) {
  let high = 0xdeadbeef
  let low = 0x41c6ce57
  for (let index = 0; index < input.length; index += 1) {
    const ch = input.charCodeAt(index)
    high = Math.imul(high ^ ch, 2654435761)
    low = Math.imul(low ^ ch, 1597334677)
  }
  high = Math.imul(high ^ (high >>> 16), 2246822507) ^ Math.imul(low ^ (low >>> 13), 3266489909)
  return (high >>> 0).toString(16).padStart(8, "0")
}
