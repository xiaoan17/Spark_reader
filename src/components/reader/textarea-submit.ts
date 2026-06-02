import type { KeyboardEvent } from "react"

export function shouldSubmitTextarea(event: KeyboardEvent<HTMLTextAreaElement>) {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.nativeEvent.isComposing
  )
}
