import { describe, expect, it } from "vitest"
import { findHighlightCardId, generatedHighlightNote } from "./highlight-card"
import type { KnowledgeCard } from "@/stores/reader-store"

function makeCard(overrides: Partial<KnowledgeCard>): KnowledgeCard {
  return {
    cardId: "kb-highlight-x",
    bookId: "book-1",
    cardType: "highlight",
    title: "标题",
    summary: "",
    bodyMarkdown: "",
    payloadJson: "{}",
    status: "confirmed",
    source: "highlight",
    confidence: 1,
    sourceVersion: 1,
    userLocked: false,
    createdAt: "2026-06-08T08:00:00.000Z",
    updatedAt: "2026-06-08T08:00:00.000Z",
    evidence: [],
    ...overrides,
  }
}

describe("findHighlightCardId", () => {
  it("matches a highlight card by its sedimentation source", () => {
    const cards = [
      makeCard({
        cardId: "kb-highlight-1",
        payloadJson: JSON.stringify({ sourceTable: "highlights", sourceId: "hl-1" }),
      }),
    ]
    expect(findHighlightCardId(cards, "hl-1")).toBe("kb-highlight-1")
  })

  it("returns null when no card sediments from the highlight", () => {
    const cards = [
      makeCard({
        cardId: "kb-highlight-2",
        payloadJson: JSON.stringify({ sourceTable: "highlights", sourceId: "other" }),
      }),
    ]
    expect(findHighlightCardId(cards, "hl-1")).toBeNull()
  })

  it("ignores non-highlight card types and malformed payloads", () => {
    const cards = [
      makeCard({
        cardId: "kb-note",
        cardType: "note",
        payloadJson: JSON.stringify({ sourceTable: "highlights", sourceId: "hl-1" }),
      }),
      makeCard({ cardId: "kb-broken", payloadJson: "{not json" }),
    ]
    expect(findHighlightCardId(cards, "hl-1")).toBeNull()
  })
})

describe("generatedHighlightNote", () => {
  it("treats the pre-filled quote body as not-yet-a-note", () => {
    const card = makeCard({ bodyMarkdown: "复利来自时间。" })
    expect(generatedHighlightNote(card, "复利来自时间。")).toBeNull()
  })

  it("returns a real generated note that differs from the quote", () => {
    const card = makeCard({ bodyMarkdown: "作者用复利说明长期主义的重要性。" })
    expect(generatedHighlightNote(card, "复利来自时间。")).toBe("作者用复利说明长期主义的重要性。")
  })

  it("returns null for empty body or missing card", () => {
    expect(generatedHighlightNote(makeCard({ bodyMarkdown: "" }), "复利来自时间。")).toBeNull()
    expect(generatedHighlightNote(null, "复利来自时间。")).toBeNull()
  })
})
