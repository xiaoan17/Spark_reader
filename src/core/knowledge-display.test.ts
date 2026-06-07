import { describe, expect, it } from "vitest"

import {
  KNOWLEDGE_CARD_TYPES,
  driftNotice,
  formatConfidencePercent,
  formatHealthSummary,
  isLowConfidence,
  labelForCardType,
  labelForSource,
  labelForStatus,
} from "./knowledge-display"

describe("labelForCardType", () => {
  it("maps known card types to Chinese labels", () => {
    expect(labelForCardType("highlight")).toBe("高亮")
    expect(labelForCardType("interpretation")).toBe("解读")
    expect(labelForCardType("summary")).toBe("章节")
  })

  it("falls back to the raw value, then a generic label", () => {
    expect(labelForCardType("mystery")).toBe("mystery")
    expect(labelForCardType("")).toBe("卡片")
  })

  it("covers every canonical card type", () => {
    for (const type of KNOWLEDGE_CARD_TYPES) {
      const label = labelForCardType(type)
      expect(label).not.toBe("卡片")
      expect(label.length).toBeGreaterThan(0)
    }
  })
})

describe("labelForStatus", () => {
  it("maps known statuses", () => {
    expect(labelForStatus("confirmed")).toBe("已确认")
    expect(labelForStatus("candidate")).toBe("候选")
    expect(labelForStatus("rejected")).toBe("已拒绝")
  })

  it("falls back for unknown/empty", () => {
    expect(labelForStatus("weird")).toBe("weird")
    expect(labelForStatus("")).toBe("未知")
  })
})

describe("labelForSource", () => {
  it("maps known sources and falls back", () => {
    expect(labelForSource("llm")).toBe("AI")
    expect(labelForSource("user")).toBe("用户")
    expect(labelForSource("")).toBe("未知")
    expect(labelForSource("custom")).toBe("custom")
  })
})

describe("formatConfidencePercent", () => {
  it("formats fractions as integer percents", () => {
    expect(formatConfidencePercent(0)).toBe("0%")
    expect(formatConfidencePercent(0.42)).toBe("42%")
    expect(formatConfidencePercent(1)).toBe("100%")
  })

  it("clamps out-of-range values", () => {
    expect(formatConfidencePercent(-0.5)).toBe("0%")
    expect(formatConfidencePercent(1.8)).toBe("100%")
  })

  it("handles non-finite input gracefully", () => {
    expect(formatConfidencePercent(Number.NaN)).toBe("—")
  })
})

describe("isLowConfidence", () => {
  it("treats confirmed cards as never low-confidence", () => {
    expect(isLowConfidence({ status: "confirmed", confidence: 0.1 })).toBe(false)
  })

  it("flags low-confidence candidates", () => {
    expect(isLowConfidence({ status: "candidate", confidence: 0.3 })).toBe(true)
    expect(isLowConfidence({ status: "candidate", confidence: 0.8 })).toBe(false)
  })
})

describe("driftNotice", () => {
  it("returns null when nothing drifted", () => {
    expect(driftNotice(0)).toBeNull()
    expect(driftNotice(-1)).toBeNull()
    expect(driftNotice(Number.NaN)).toBeNull()
  })

  it("returns a notice mentioning the count", () => {
    expect(driftNotice(3)).toContain("3")
    expect(driftNotice(3)).toContain("复核")
  })
})

describe("formatHealthSummary", () => {
  it("renders a compact summary line", () => {
    expect(
      formatHealthSummary({ confirmedCount: 2, candidateCount: 5, driftCount: 1 }),
    ).toBe("已确认 2 / 候选 5 / 漂移 1")
  })
})
