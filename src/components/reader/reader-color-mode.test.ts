import { describe, expect, it } from "vitest"
import {
  normalizeReaderColorMode,
  resolveReaderColorMode,
} from "./reader-color-mode"

describe("reader color mode", () => {
  it("defaults unknown persisted values to follow-system", () => {
    expect(normalizeReaderColorMode("light")).toBe("light")
    expect(normalizeReaderColorMode("dark")).toBe("dark")
    expect(normalizeReaderColorMode("system")).toBe("system")
    expect(normalizeReaderColorMode(null)).toBe("system")
    expect(normalizeReaderColorMode("weird")).toBe("system")
  })

  it("resolves explicit modes regardless of system preference", () => {
    expect(resolveReaderColorMode("light", true)).toBe("light")
    expect(resolveReaderColorMode("dark", false)).toBe("dark")
  })

  it("follows the system preference only in system mode", () => {
    expect(resolveReaderColorMode("system", true)).toBe("dark")
    expect(resolveReaderColorMode("system", false)).toBe("light")
  })
})
