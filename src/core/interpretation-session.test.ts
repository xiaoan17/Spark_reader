import { describe, expect, it } from "vitest"
import { planInterpretationTurn } from "./interpretation-session"

describe("planInterpretationTurn", () => {
  it("creates a session for an initial interpretation", () => {
    const plan = planInterpretationTurn({
      currentSessionId: "",
      intent: "initial",
      followUpCount: 3,
      createSessionId: () => "session-new",
    })

    expect(plan).toEqual({
      sessionId: "session-new",
      turnIndex: 0,
      createdSession: true,
    })
  })

  it("keeps follow-ups in the active session", () => {
    const plan = planInterpretationTurn({
      currentSessionId: "session-existing",
      intent: "follow_up",
      followUpCount: 2,
      createSessionId: () => "unused",
    })

    expect(plan).toEqual({
      sessionId: "session-existing",
      turnIndex: 3,
      createdSession: false,
    })
  })

  it("creates a stable session when a follow-up is sent before an initial answer was saved", () => {
    const plan = planInterpretationTurn({
      currentSessionId: null,
      intent: "follow_up",
      followUpCount: 0,
      createSessionId: () => "session-from-follow-up",
    })

    expect(plan).toEqual({
      sessionId: "session-from-follow-up",
      turnIndex: 1,
      createdSession: true,
    })
  })
})
