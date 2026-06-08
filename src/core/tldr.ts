export const TLDR_SOURCE_VERSION = 3

export function isCurrentTldrSourceVersion(value?: number | null) {
  return value === TLDR_SOURCE_VERSION
}
