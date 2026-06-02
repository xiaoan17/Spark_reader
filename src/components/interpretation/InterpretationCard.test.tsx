import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { InterpretationCard, renderCitations } from "./InterpretationCard"

const chunkA = "b12345678-p1-c1-abcdef12"
const chunkB = "b12345678-p2-c1-bbbbbbbb"
const chunkC = "b12345678-p3-c2-cccccccc"

describe("InterpretationCard citations", () => {
  it("renders internal references as readable citation buttons", () => {
    const html = renderToStaticMarkup(
      renderCitations(`这句话需要证据 [${chunkA}] 和 [${chunkB}]。`),
    )

    expect(html).toContain("<button")
    expect(html).toContain("引用")
    expect(html).not.toContain(`[${chunkA}]`)
    expect(html).not.toContain(`[${chunkB}]`)
  })

  it("does not turn ordinary bracketed labels into citations", () => {
    const html = renderToStaticMarkup(renderCitations("普通标注 [说明] 不应该变成按钮。"))

    expect(html).not.toContain("<button")
    expect(html).toContain("[说明]")
  })

  it("renders multi-citation brackets as separate clickable buttons", () => {
    const html = renderToStaticMarkup(
      renderCitations(`这个判断依赖 [${chunkA}, ${chunkB}]，也可见【${chunkC}】。`),
    )

    expect(html.match(/<button/g)).toHaveLength(3)
    expect(html).toContain("引用")
    expect(html).not.toContain(`[${chunkA}]`)
    expect(html).not.toContain(`[${chunkB}]`)
    expect(html).not.toContain(`【${chunkC}】`)
  })

  it("renders unresolved namespaced ids as non-clickable readable labels when restricted", () => {
    const html = renderToStaticMarkup(
      renderCitations(
        `已知证据 [${chunkA}]，旧答案残留 [${chunkB}]。`,
        undefined,
        new Set([chunkA]),
      ),
    )

    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).toContain("引用")
    expect(html).not.toContain(`[${chunkA}]`)
    expect(html).not.toContain(`[${chunkB}]`)
    expect(html).toContain("引用")
  })

  it("uses evidence ids as clickable citation targets in the card", () => {
    const html = renderToStaticMarkup(
      <InterpretationCard
        phase="reading"
        selectionText="复利来自长期坚持"
        selectionRects={[]}
        evidence={[{ chunkId: chunkA, title: `Chunk ${chunkA}`, pageIndex: 0 }]}
        interpretation={`这一点可以核对 [${chunkA}]，但旧引用 [${chunkB}] 不应可点。`}
        followUps={[]}
      />,
    )

    expect(html.match(/<button/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(html).toContain("相关段落")
    expect(html).not.toContain(`[${chunkA}]`)
    expect(html).not.toContain(`[${chunkB}]`)
    expect(html).toContain("未核验引用")
  })

  it("renders markdown structure in interpretation answers", () => {
    const html = renderToStaticMarkup(
      <InterpretationCard
        phase="reading"
        selectionText="KnowMTP improves MTP baselines"
        selectionRects={[]}
        evidence={[{ chunkId: chunkA, title: `Chunk ${chunkA}`, pageIndex: 0 }]}
        interpretation={`### 核心结论\n\n这是**关键提升**。\n\n| 指标 | 变化 |\n| --- | --- |\n| 成本 | 降低 |\n\n证据见 [${chunkA}]。`}
        followUps={[]}
      />,
    )

    expect(html).toContain("<h3")
    expect(html).toContain("<strong>关键提升</strong>")
    expect(html).toContain("<table")
    expect(html).toContain("<button")
    expect(html).not.toContain("### 核心结论")
    expect(html).not.toContain("| 指标 | 变化 |")
  })

  it("renders LaTeX math in markdown answers", () => {
    const html = renderToStaticMarkup(
      <InterpretationCard
        phase="reading"
        selectionText="MTP objective"
        selectionRects={[]}
        evidence={[]}
        interpretation={`行内公式 $c_{ij}=\\lVert s_i-s_j\\rVert_2$。\n\n$$\\mathbf{X}_n=\\left\\{\\mathbf{x}^{-T_h:0}\\right\\}_n$$`}
        followUps={[]}
      />,
    )

    expect(html).toContain("katex")
    expect(html).toContain("katex-display")
    expect(html).not.toContain("$c_{ij}")
    expect(html).not.toContain("$$")
  })

  it("does not render raw html from model output", () => {
    const html = renderToStaticMarkup(
      <InterpretationCard
        phase="reading"
        selectionText="复利来自长期坚持"
        evidence={[]}
        interpretation={'<img src=x onerror="alert(1)" /> **安全文本**'}
        followUps={[]}
      />,
    )

    expect(html).toContain("&lt;img")
    expect(html).toContain("<strong>安全文本</strong>")
    expect(html).not.toContain("onerror=\"alert(1)\"")
  })

  it("renders follow-up answers with clickable citations even before a main answer exists", () => {
    const html = renderToStaticMarkup(
      <InterpretationCard
        phase="reading"
        selectionText="复利来自长期坚持"
        selectionRects={[]}
        evidence={[{ chunkId: chunkA, title: `Chunk ${chunkA}`, pageIndex: 0 }]}
        interpretation=""
        followUps={[
          {
            id: "turn-1",
            question: "为什么强调长期？",
            answer: `因为证据显示时间会放大差异。[${chunkA}]`,
          },
        ]}
      />,
    )

    expect(html).toContain("为什么强调长期")
    expect(html).toContain("<button")
    expect(html).toContain("相关段落")
    expect(html).not.toContain(`[${chunkA}]`)
  })

  it("keeps a restored follow-up separate from the main interpretation", () => {
    const html = renderToStaticMarkup(
      <InterpretationCard
        phase="reading"
        selectionText="复利来自长期坚持"
        selectionRects={[]}
        evidence={[]}
        interpretation=""
        followUps={[
          {
            id: "saved-follow-up",
            question: "这和前文有什么关系？",
            answer: `它承接了前文关于时间尺度的论证。[${chunkB}]`,
          },
        ]}
      />,
    )

    expect(html).toContain("这和前文有什么关系")
    expect(html).toContain("它承接了前文")
    expect(html).toContain("引用")
    expect(html).not.toContain(`[${chunkB}]`)
  })

  it("marks local fallback answers explicitly", () => {
    const html = renderToStaticMarkup(
      <InterpretationCard
        phase="reading"
        selectionText="复利来自长期坚持"
        evidence={[{ chunkId: chunkA, title: `Chunk ${chunkA}`, pageIndex: 0 }]}
        interpretation={`本地模板生成。[${chunkA}]`}
        answerSource="local_fallback"
        followUps={[]}
      />,
    )

    expect(html).toContain("本地模板兜底")
    expect(html).toContain("完整 LLM 解读需要桌面版")
    expect(html).not.toContain("后端")
  })

  it("explains why a local fallback answer is being shown", () => {
    const html = renderToStaticMarkup(
      <InterpretationCard
        phase="reading"
        selectionText="复利来自长期坚持"
        evidence={[{ chunkId: chunkA, title: `Chunk ${chunkA}`, pageIndex: 0 }]}
        interpretation={`本地模板生成。[${chunkA}]`}
        answerSource="local_fallback"
        errorMessage="完整 LLM 解读需要有效的 API Key，当前已改用本地兜底。请在设置中检查 LLM API Key。"
        followUps={[]}
      />,
    )

    expect(html).toContain("本地模板兜底")
    expect(html).toContain("完整 LLM 解读需要有效的 API Key")
    expect(html).toContain("当前已改用本地兜底")
  })

  it("offers a settings action when local fallback is caused by missing setup", () => {
    const html = renderToStaticMarkup(
      <InterpretationCard
        phase="reading"
        selectionText="复利来自长期坚持"
        evidence={[{ chunkId: chunkA, title: `Chunk ${chunkA}`, pageIndex: 0 }]}
        interpretation={`本地模板生成。[${chunkA}]`}
        answerSource="local_fallback"
        errorMessage="DeepSeek 还没有配置 API Key，当前已改用本地兜底。"
        followUps={[]}
        onOpenSettings={() => undefined}
      />,
    )

    expect(html).toContain("打开设置")
    expect(html).toContain("DeepSeek 还没有配置 API Key")
  })

  it("renders a readable collapsed retrieval trace without leaking chunk ids", () => {
    const html = renderToStaticMarkup(
      <InterpretationCard
        phase="reading"
        selectionText="复利来自长期坚持"
        evidence={[{ chunkId: chunkA, title: `Chunk ${chunkA}`, pageIndex: 0 }]}
        agentTrace={[
          {
            phase: "plan",
            query: "llm_tool_round_1",
            chunkIds: [chunkA],
            note: `模型调用 search_book 后命中 [${chunkA}]。`,
          },
          {
            phase: "synthesize",
            query: "deterministic_fallback",
            chunkIds: [],
            note: "启用后端确定性检索作为最后防线。",
          },
        ]}
        interpretation={`本地模板生成。[${chunkA}]`}
        followUps={[]}
      />,
    )

    expect(html).toContain("<details")
    expect(html).toContain("检索轨迹 · 2 步")
    expect(html).toContain("模型检索第 1 轮")
    expect(html).toContain("本地补检索")
    expect(html).toContain("相关段落")
    expect(html).not.toContain(chunkA)
  })

  it("keeps converted-text selections focused on the answer instead of status copy", () => {
    const html = renderToStaticMarkup(
      <InterpretationCard
        phase="reading"
        selectionText="复利来自长期坚持"
        selectionRects={[]}
        evidence={[]}
        interpretation="这是一段解读。"
        followUps={[]}
      />,
    )

    expect(html).toContain("这是一段解读。")
    expect(html).not.toContain("转换稿选区（推荐）")
    expect(html).not.toContain("保存为文本锚点")
  })

  it("keeps PDF coordinate details collapsed behind an explicit calibration label", () => {
    const html = renderToStaticMarkup(
      <InterpretationCard
        phase="reading"
        selectionText="复利来自长期坚持"
        selectionRects={[{ pageIndex: 0, x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.3 }]}
        evidence={[]}
        interpretation="这是一段解读。"
        followUps={[]}
      />,
    )

    expect(html).toContain("<details")
    expect(html).toContain("PDF 坐标选区（校对）")
    expect(html).toContain("归一化页坐标")
    expect(html).toContain("1 个矩形")
    expect(html).toContain("p1: [0.1000, 0.2000")
    expect(html).toContain("扫描版或 OCR 结果可能近似")
  })

  it("shows the provider error message in the failed state", () => {
    const html = renderToStaticMarkup(
      <InterpretationCard
        phase="error"
        selectionText="复利来自长期坚持"
        evidence={[]}
        interpretation=""
        errorMessage="DeepSeek API key 未配置"
        followUps={[]}
      />,
    )

    expect(html).toContain("解读失败")
    expect(html).toContain("DeepSeek API key 未配置")
  })

  it("renders runtime availability guidance", () => {
    const html = renderToStaticMarkup(
      <InterpretationCard
        phase="reading"
        selectionText=""
        evidence={[]}
        interpretation=""
        followUps={[]}
        runtimeHint="浏览器版会使用已转换文本做本地兜底解读；完整 LLM 能力需要桌面版。"
      />,
    )

    expect(html).toContain("浏览器版会使用已转换文本做本地兜底解读")
  })
})
