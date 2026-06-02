import { describe, expect, it } from "vitest"
import {
  chunkIdsInCitation,
  replaceInternalCitationsWithReadableLabels,
} from "./citation-display"

const chunkA = "b12345678-p1-c1-abcdef12"
const chunkB = "b12345678-p2-c3-0000abcd"

describe("citation display parsing", () => {
  it("accepts only namespaced chunk ids while ignoring ordinary labels", () => {
    expect(chunkIdsInCitation(`${chunkA}, p1-c1, chunk-02, mineru_block_12, chap03_pg5, 说明`)).toEqual([
      chunkA,
    ])
  })

  it("replaces bracketed citation ids but leaves ordinary brackets", () => {
    const text = `普通说明 [不是引用] 保留，证据见 [${chunkA}; ${chunkB}]，旧证据 [p1-c1] 不处理。`

    expect(replaceInternalCitationsWithReadableLabels(text)).toBe(
      "普通说明 [不是引用] 保留，证据见 （引用）（引用），旧证据 [p1-c1] 不处理。",
    )
  })
})
