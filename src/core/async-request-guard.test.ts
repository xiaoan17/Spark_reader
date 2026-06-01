import { describe, expect, it } from "vitest"
import { createRequestGuard } from "./async-request-guard"

describe("async request guard", () => {
  it("marks earlier requests stale after a newer request starts", () => {
    const guard = createRequestGuard()
    const first = guard.start()
    const second = guard.start()

    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })

  it("invalidates in-flight requests when stopped", () => {
    const guard = createRequestGuard()
    const request = guard.start()
    guard.stop()

    expect(guard.isCurrent(request)).toBe(false)
  })

  it("exposes the active version for debugging and deterministic tests", () => {
    const guard = createRequestGuard(4)
    expect(guard.current()).toBe(4)
    expect(guard.start()).toBe(5)
    expect(guard.current()).toBe(5)
  })
})
