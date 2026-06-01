import type { EvidencePreview, FollowUpTurn } from "@/stores/reader-store"
import {
  citationLabelMap,
  evidenceLabel,
  sanitizeInternalReferenceText,
} from "@/core/citation-display"

export function formatInterpretationClipboardText(
  selectionText: string,
  interpretation: string,
  followUps: FollowUpTurn[],
  evidence: EvidencePreview[],
) {
  const sections: string[] = []
  const citationLabels = citationLabelMap(evidence)
  if (selectionText.trim()) {
    sections.push(`选中文本：\n${selectionText.trim()}`)
  }
  if (interpretation.trim()) {
    sections.push(`AI 解读：\n${sanitizeInternalReferenceText(interpretation.trim(), citationLabels)}`)
  }
  if (followUps.length > 0) {
    sections.push(
      `追问：\n${followUps
        .map((turn, index) => (
          `${index + 1}. ${turn.question}\n${sanitizeInternalReferenceText(turn.answer, citationLabels)}`
        ))
        .join("\n\n")}`,
    )
  }
  if (evidence.length > 0) {
    sections.push(
      `引用证据：\n${evidence
        .map((item, index) => evidenceLabel(item, evidence, index))
        .join("\n")}`,
    )
  }
  return sections.join("\n\n")
}
