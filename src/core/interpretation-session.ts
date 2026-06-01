export type InterpretationTurnIntent = "initial" | "follow_up"

export type InterpretationTurnPlan = {
  sessionId: string
  turnIndex: number
  createdSession: boolean
}

type PlanInterpretationTurnOptions = {
  currentSessionId?: string | null
  intent: InterpretationTurnIntent
  followUpCount: number
  createSessionId: () => string
}

export function planInterpretationTurn({
  currentSessionId,
  intent,
  followUpCount,
  createSessionId,
}: PlanInterpretationTurnOptions): InterpretationTurnPlan {
  const existingSessionId = currentSessionId?.trim() ?? ""
  const createdSession = existingSessionId.length === 0
  const sessionId = createdSession ? createSessionId() : existingSessionId

  return {
    sessionId,
    turnIndex: intent === "follow_up" ? Math.max(0, followUpCount) + 1 : 0,
    createdSession,
  }
}

export function makeInterpretationSessionId() {
  return `interpretation-session-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
