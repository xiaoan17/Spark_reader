import type { NormalizedPageRect } from "@/core/coordinates"

export function highlightSaveFeedback({
  hasBook,
  saved,
  selectionRects,
}: {
  hasBook: boolean
  saved: boolean
  selectionRects: NormalizedPageRect[]
}) {
  if (!saved) {
    return hasBook ? "高亮保存失败，请检查书库状态" : "当前运行环境暂未写入本地库"
  }

  return selectionRects.length > 0
    ? "已保存 PDF 几何高亮和文本锚点"
    : "已保存转换稿文本高亮"
}
