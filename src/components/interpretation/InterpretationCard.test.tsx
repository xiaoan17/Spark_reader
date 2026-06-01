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
    expect(html).toContain("第 2 页 · 引用")
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
    expect(html).toContain("第 1 页 · 相关段落")
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
    expect(html).toContain("第 1 页 · 相关段落")
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
  })

  it("shows the backend error message in the failed state", () => {
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
        runtimeHint="浏览器预览会使用已转换文本做本地兜底解读；完整后端能力需要桌面端。"
      />,
    )

    expect(html).toContain("浏览器预览会使用已转换文本做本地兜底解读")
  })
})
