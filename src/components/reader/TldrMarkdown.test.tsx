import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TldrReader } from "./TldrReader"

const markdownTldr = "**核心结论**：文档把隔夜收益作为主要线索。\n\n- 第一层\n- 第二层"

describe("TLDR markdown rendering", () => {
  it("renders markdown syntax in the TLDR reader page", () => {
    const html = renderToStaticMarkup(<TldrReader text={markdownTldr} />)

    expect(html).toContain("<strong>核心结论</strong>")
    expect(html).toContain("<li")
    expect(html).not.toContain("**核心结论**")
  })

  it("uses the reader display theme for mixed Chinese and English TLDR prose", () => {
    const html = renderToStaticMarkup(
      <TldrReader text="这份 Computer 报告比较 Search 和 AI agents 的成本。" />,
    )

    expect(html).toContain("reader-markdown")
    expect(html).toContain("reader-display-theme")
    expect(html).not.toContain("font-reading")
  })
})
