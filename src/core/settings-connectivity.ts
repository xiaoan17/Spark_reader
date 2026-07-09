import {
  normalizeCommandError,
  saveLlmSettings,
  saveMineruSettings,
  testLlmConnectionWithSettings,
  testMineruConnectionWithSettings,
  type LlmConnectionTestResponse,
  type LlmSettings,
  type MinerUConnectionTestResponse,
  type MinerUSettings,
  type SaveLlmSettingsRequest,
  type SaveMinerUSettingsRequest,
} from "@/core/library-api"

/**
 * 把后端命令错误格式化成「消息。建议：xxx」。设置面板与首次配置向导共用同一份文案逻辑,
 * 保证两处对同一错误的展示完全一致。
 */
export function formatSettingsError(error: unknown) {
  const normalized = normalizeCommandError(error)
  if (!normalized.suggestion) {
    return normalized.message
  }

  const messageWithoutSuggestion = normalized.message
    .replace(normalized.suggestion, "")
    .replace(/[。.\s]+$/, "")
  return `${messageWithoutSuggestion}。建议：${normalized.suggestion}`
}

export type LlmSaveTestResult = {
  settings: LlmSettings
  test: LlmConnectionTestResponse
}

/**
 * 先保存再就地跑连通测试(向导语义)。设置面板的「测试并记录」是「先测再存」,两者顺序不同,
 * 但都复用同一批 library-api 命令,不另起一套连通测试实现。
 */
export async function saveThenTestLlm(request: SaveLlmSettingsRequest): Promise<LlmSaveTestResult> {
  const settings = await saveLlmSettings(request)
  const test = await testLlmConnectionWithSettings(request)
  return { settings, test }
}

export type MineruSaveTestResult = {
  settings: MinerUSettings
  test: MinerUConnectionTestResponse
}

export async function saveThenTestMineru(
  request: SaveMinerUSettingsRequest,
): Promise<MineruSaveTestResult> {
  const settings = await saveMineruSettings(request)
  const test = await testMineruConnectionWithSettings(request)
  return { settings, test }
}
