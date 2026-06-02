import type {
  EvidencePreview,
  ParsedChunk,
  ParsedPage,
  TextAssetMetadata,
  TextSelectionAnchor,
} from "@/stores/reader-store"

export type SampleBook = {
  title: string
  pages: ParsedPage[]
  chunks: ParsedChunk[]
  text: string
  markdown: string
  metadata: TextAssetMetadata
  initialSelection: {
    text: string
    anchor: TextSelectionAnchor
  }
  evidence: EvidencePreview[]
  interpretation: string
  agentTrace: {
    phase: "plan" | "retrieve" | "iterate" | "synthesize"
    query?: string | null
    chunkIds: string[]
    note: string
  }[]
}

const SAMPLE_TITLE = "框选精读示例书"

const SAMPLE_PAGE_TEXT = [
  [
    "框选不是普通高亮，而是一次带上下文的阅读提问。",
    "当读者选中一段文字时，系统先把选区落到转换稿的文本锚点，再连接到可检索的证据段落。这样做的目的不是让模型凭印象回答，而是让每一次解释都能回到原文。",
    "如果云端模型或桌面书库索引暂时不可用，应用仍然可以使用本地转换稿给出兜底解释。这个模式牺牲了一部分语义召回，但能保留框选、引用、追问三条核心交互链路。",
  ],
  [
    "引用回跳是这个阅读器的质量线。",
    "一个答案如果只给结论，读者仍然要重新查找原文核对；一个答案如果带有可回跳引用，界面就可以把引用解析回具体段落，并在转换稿里闪烁标出目标文本。",
    "因此持久引用使用稳定的书内证据标识，而不是供应商原生 citation 或 pdf.js 字符偏移。字符偏移适合当下提示，不能当作跨解析版本的耐久锚点。",
  ],
  [
    "长文档性能依赖窗口化渲染。",
    "PDF 的 canvas 与文本层都很重，转换稿的 Markdown 树也会随着文档长度线性膨胀。实际阅读时，用户只需要当前视口附近的内容；离开窗口的内容应该卸载，只保留高度占位和内部定位。",
    "这种取舍让长书不会因为一次性挂载所有内容而卡死，也让引用跳转和滚动位置仍然保持可用。",
  ],
]

const SAMPLE_PAGE_MARKDOWN = [
  [
    "## 框选是一种带上下文的提问",
    "",
    "框选不是普通高亮，而是一次带上下文的阅读提问。",
    "",
    "当读者选中一段文字时，系统先把选区落到转换稿的文本锚点，再连接到可检索的证据段落。这样做的目的不是让模型凭印象回答，而是让每一次解释都能回到原文。",
    "",
    "如果云端模型或桌面书库索引暂时不可用，应用仍然可以使用本地转换稿给出兜底解释。这个模式牺牲了一部分语义召回，但能保留框选、引用、追问三条核心交互链路。",
  ],
  [
    "## 引用必须能回跳",
    "",
    "引用回跳是这个阅读器的质量线。",
    "",
    "一个答案如果只给结论，读者仍然要重新查找原文核对；一个答案如果带有可回跳引用，界面就可以把引用解析回具体段落，并在转换稿里闪烁标出目标文本。",
    "",
    "因此持久引用使用稳定的书内证据标识，而不是供应商原生 citation 或 pdf.js 字符偏移。字符偏移适合当下提示，不能当作跨解析版本的耐久锚点。",
  ],
  [
    "## 长文档需要窗口化",
    "",
    "长文档性能依赖窗口化渲染。",
    "",
    "PDF 的 canvas 与文本层都很重，转换稿的 Markdown 树也会随着文档长度线性膨胀。实际阅读时，用户只需要当前视口附近的内容；离开窗口的内容应该卸载，只保留高度占位和内部定位。",
    "",
    "这种取舍让长书不会因为一次性挂载所有内容而卡死，也让引用跳转和滚动位置仍然保持可用。",
  ],
]

export function createSampleBook(): SampleBook {
  const pages = SAMPLE_PAGE_TEXT.map((paragraphs, pageIndex) => ({
    pageIndex,
    text: paragraphs.join("\n\n"),
    markdown: SAMPLE_PAGE_MARKDOWN[pageIndex].join("\n"),
  }))
  const chunks = pages.flatMap((page) =>
    page.text
      .split(/\n\n+/)
      .filter(Boolean)
      .map((paragraph, index) => ({
        chunkId: `sample-p${page.pageIndex + 1}-c${index + 1}`,
        pageIndex: page.pageIndex,
        text: paragraph,
        markdown: paragraph,
        rects: [],
        coordinateVersion: 1,
      })),
  )
  const selectionText = SAMPLE_PAGE_TEXT[0][1]
  const positionStart = pages[0].text.indexOf(selectionText)
  const anchor = {
    pageIndex: 0,
    positionStart,
    positionEnd: positionStart + selectionText.length,
  }
  const evidence = chunks.slice(0, 3).map((chunk) => ({
    chunkId: chunk.chunkId,
    title: "示例证据",
    pageIndex: chunk.pageIndex,
  }))
  const interpretation = [
    "这段话在说明：框选精读不是把选区交给模型自由发挥，而是先把选中的文字固定到转换稿里的文本锚点，再找到可核对的证据段落。[sample-p1-c2]",
    "它的核心价值是把“解释”和“回到原文验证”连起来。读者看到答案后，可以通过引用回跳定位到原段落，而不是只相信一段没有出处的总结。[sample-p1-c2]",
    "即使暂时没有配置云端 LLM，示例书也会展示本地兜底链路：仍然保留选区、证据和引用这三个关键交互，只是语义召回能力较弱。[sample-p1-c3]",
  ].join("\n\n")
  const agentTrace = [
    {
      phase: "plan" as const,
      query: "sample_onboarding",
      chunkIds: ["sample-p1-c2"],
      note: "示例书已预置框选段落，直接展示从选区到引用证据的阅读链路。",
    },
    {
      phase: "synthesize" as const,
      query: null,
      chunkIds: evidence.map((item) => item.chunkId),
      note: "使用本地示例证据生成可回跳的说明，无需配置 key。",
    },
  ]

  return {
    title: SAMPLE_TITLE,
    pages,
    chunks,
    text: pages.map((page) => page.text).join("\n\n"),
    markdown: pages.map((page) => page.markdown).join("\n\n---\n\n"),
    metadata: {
      parserEngine: "sample-converted-text",
      coordinateMode: "text-only",
      quality: {
        charCount: pages.reduce((sum, page) => sum + page.text.length, 0),
        replacementCharRatio: 0,
        controlCharRatio: 0,
        looksUsable: true,
      },
    },
    initialSelection: {
      text: selectionText,
      anchor,
    },
    evidence,
    interpretation,
    agentTrace,
  }
}
