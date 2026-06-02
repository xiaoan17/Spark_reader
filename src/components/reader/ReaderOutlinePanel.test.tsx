import { renderToStaticMarkup } from "react-dom/server"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { ReaderOutlinePanel } from "./ReaderOutlinePanel"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

describe("ReaderOutlinePanel", () => {
  it("renders section outline entries with page targets", () => {
    const html = renderToStaticMarkup(
      <ReaderOutlinePanel
        currentPage={1}
        entries={[
          {
            id: "toc-1",
            pageIndex: 0,
            title: "问题定义",
            level: 1,
            sectionNumber: "1.1",
            chunkCount: 1,
            preview: "本节解释核心问题",
            firstChunkId: "p1-c1",
          },
          {
            id: "toc-2",
            pageIndex: 1,
            title: "研究方法",
            level: 2,
            sectionNumber: "1.2",
            chunkCount: 0,
            preview: "",
          },
        ]}
        onSelect={() => undefined}
      />,
    )

    expect(html).toContain("目录")
    expect(html).toContain("1.1")
    expect(html).toContain("问题定义")
    expect(html).not.toContain("本节解释核心问题")
    expect(html).not.toContain("chunks")
    expect(html).not.toContain("当前页暂无 Markdown 内容")
  })

  it("keeps the active outline entry visible as the reader page changes", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const entries = [
      {
        id: "toc-1",
        pageIndex: 0,
        title: "问题定义",
        level: 1,
        sectionNumber: "1.1",
        chunkCount: 1,
        preview: "",
      },
      {
        id: "toc-2",
        pageIndex: 4,
        title: "研究方法",
        level: 1,
        sectionNumber: "2",
        chunkCount: 1,
        preview: "",
      },
    ]

    await act(async () => {
      root.render(<ReaderOutlinePanel entries={entries} currentPage={5} onSelect={() => undefined} />)
      await Promise.resolve()
    })

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" })
    act(() => root.unmount())
    container.remove()
  })
})
