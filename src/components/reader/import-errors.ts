import { normalizeCommandError } from "@/core/library-api"

export function friendlyImportErrorMessage(error: unknown) {
  const commandError = normalizeCommandError(error)
  const normalized = commandError.message.trim()
  const suggestion = commandError.suggestion?.trim()
  const structuredMessage = friendlyStructuredImportErrorMessage(
    commandError.code,
    normalized,
    suggestion,
  )
  if (structuredMessage) {
    return structuredMessage
  }

  const lower = normalized.toLowerCase()
  if (lower.includes("mineru") && (lower.includes("token") || lower.includes("api token"))) {
    return "MinerU API Token 未配置或无效。请在设置里填入 MinerU token 后重试。"
  }
  if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized")) {
    return "云端解析认证失败。请检查 MinerU API Token 是否正确、是否仍有效。"
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "云端解析等待超时。请稍后重试；如果是长 PDF，建议确认页数后分批解析。"
  }
  if (
    lower.includes("network") ||
    lower.includes("connection") ||
    lower.includes("dns") ||
    lower.includes("econn")
  ) {
    return "无法连接云端解析服务。请检查网络、代理或 MinerU 服务状态后重试。"
  }
  if (lower.includes("200mb") || lower.includes("200 mb") || lower.includes("200 pages")) {
    return "PDF 超出 MinerU 单批限制。请换用较小文件，或按页码范围分批解析。"
  }
  return normalized || "导入失败，请检查文件和解析服务配置后重试。"
}

function friendlyStructuredImportErrorMessage(
  code: string,
  message: string,
  suggestion?: string,
) {
  if (!suggestion) {
    return ""
  }
  const reason = friendlyImportErrorReason(code, message, suggestion)
  return `${reason}建议：${suggestionWithoutDuplicateMessage(message, suggestion)}`
}

function friendlyImportErrorReason(code: string, message: string, suggestion: string) {
  switch (code) {
    case "mineru_token":
      return "MinerU API Token 未配置或无效。"
    case "authentication":
      return "云端解析认证失败。"
    case "timeout":
      return "云端解析等待超时。"
    case "network":
      return "无法连接云端解析服务。"
    case "mineru_limit":
      return "PDF 超出单批解析限制。"
    case "validation":
      return "导入参数或文件格式不符合要求。"
    case "not_found":
      return "找不到要导入的文件或书籍资产。"
    case "storage":
      return "本地书库读写失败。"
    default:
      return ensureSentencePunctuation(messageWithoutSuggestion(message, suggestion)) || "导入失败。"
  }
}

function suggestionWithoutDuplicateMessage(message: string, suggestion: string) {
  return suggestion.replace(message, "").replace(/^[。.\s；;]+/, "").trim() || suggestion
}

function messageWithoutSuggestion(message: string, suggestion: string) {
  return message.replace(suggestion, "").replace(/[。.\s；;]+$/, "")
}

function ensureSentencePunctuation(message: string) {
  const trimmed = message.trim()
  if (!trimmed) {
    return ""
  }
  return /[。.!！？?]$/.test(trimmed) ? trimmed : `${trimmed}。`
}
