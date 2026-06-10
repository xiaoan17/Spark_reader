import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TldrBanner } from "./TldrBanner"
import { TldrReader } from "./TldrReader"

const markdownTldr = "**核心结论**：文档把隔夜收益作为主要线索。\n\n- 第一层\n- 第二层"

describe("TLDR markdown rendering", () => {
  it("renders markdown syntax in the TLDR reader page", () => {
    const html = renderToStaticMarkup(<TldrReader text={markdownTldr} />)

    expect(html).toContain("<strong>核心结论</strong>")
    expect(html).toContain("<li")
    expect(html).not.toContain("**核心结论**")
  })

  it("uses the UI font for mixed Chinese and English TLDR prose", () => {
    const html = renderToStaticMarkup(
      <TldrReader text="这份 Computer 报告比较 Search 和 AI agents 的成本。" />,
    )

    expect(html).toContain("font-ui text-[16px]")
    expect(html).not.toContain("font-reading")
  })

  it("renders markdown syntax in the TLDR banner", () => {
    const html = renderToStaticMarkup(<TldrBanner text={markdownTldr} />)

    expect(html).toContain("<strong>核心结论</strong>")
    expect(html).toContain("<li")
    expect(html).not.toContain("**核心结论**")
  })
})
