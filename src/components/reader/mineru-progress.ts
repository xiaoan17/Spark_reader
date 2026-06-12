import type { MinerUProgressEvent } from "@/core/library-api"

export function mineruProgressMessage(event: MinerUProgressEvent) {
  const batch = mineruProgressBatchLabel(event)
  const pageRange = event.pageRange ? ` · 页码 ${event.pageRange}` : ""
  const detail = mineruProgressStageDetail(event)
  return `${mineruProgressStageLabel(event.stage)}：${detail}${batch ? ` · ${batch}` : ""}${pageRange}`
}

export function mineruProgressBatchLabel(event: MinerUProgressEvent) {
  if (
    typeof event.batchIndex !== "number" ||
    typeof event.batchTotal !== "number" ||
    event.batchIndex <= 0 ||
    event.batchTotal <= 0
  ) {
    return ""
  }
  return `第 ${event.batchIndex}/${event.batchTotal} 批`
}

function mineruProgressStageLabel(stage: MinerUProgressEvent["stage"]) {
  switch (stage) {
    case "preparing":
      return "准备上传"
    case "submitted":
      return "已提交"
    case "uploaded":
      return "已上传"
    case "polling":
      return "解析中"
    case "downloading":
      return "下载结果"
    case "extracting":
      return "解压结果"
    case "normalizing":
      return "整理文件"
    case "parsing":
      return "生成文本"
    case "indexed":
      return "已入库"
    case "failed":
      return "失败"
  }
}

function mineruProgressStageDetail(event: MinerUProgressEvent) {
  switch (event.stage) {
    case "polling":
      return "MinerU 正在解析中"
    default:
      return event.message
  }
}
