import { describe, expect, it } from "vitest"
import { shouldSubmitTextarea } from "./textarea-submit"

function keyEvent(overrides: Partial<React.KeyboardEvent<HTMLTextAreaElement>> = {}) {
  return {
    key: "Enter",
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    nativeEvent: { isComposing: false } as KeyboardEvent,
    ...overrides,
  } as React.KeyboardEvent<HTMLTextAreaElement>
}

describe("shouldSubmitTextarea", () => {
  it("submits on plain Enter", () => {
    expect(shouldSubmitTextarea(keyEvent())).toBe(true)
  })

  it("keeps modified Enter combinations for line breaks", () => {
    expect(shouldSubmitTextarea(keyEvent({ ctrlKey: true }))).toBe(false)
    expect(shouldSubmitTextarea(keyEvent({ metaKey: true }))).toBe(false)
    expect(shouldSubmitTextarea(keyEvent({ shiftKey: true }))).toBe(false)
  })

  it("does not submit while IME composition is active", () => {
    expect(shouldSubmitTextarea(keyEvent({ nativeEvent: { isComposing: true } as KeyboardEvent }))).toBe(false)
  })
})
