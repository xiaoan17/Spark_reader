import { describe, expect, it, vi } from "vitest"
import {
  buildChunks,
  extractPdfText,
  pageToMarkdown,
  textContentToBlocks,
  textContentToPlainText,
  textItemToNormalizedRect,
} from "./pdf-text-extractor"
import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api"

describe("pdf text extraction helpers", () => {
  it("normalizes pdf.js text content into plain text", () => {
    const textContent = {
      items: [
        { str: "复利", hasEOL: false },
        { str: "来自时间", hasEOL: true },
        { str: "  ", hasEOL: true },
        { str: "风险控制", hasEOL: false },
      ],
      styles: {},
    } as unknown as TextContent

    expect(textContentToPlainText(textContent)).toBe("复利 来自时间\n\n风险控制")
  })

  it("creates stable page-local chunk ids from converted text", () => {
    const chunks = buildChunks([
      {
        pageIndex: 0,
        text: "第一段。\n\n第二段。",
        markdown: pageToMarkdown(1, "第一段。\n\n第二段。"),
      },
    ])

    expect(chunks).toHaveLength(1)
    expect(chunks[0].chunkId).toMatch(/^b503f19a9-p1-c1-[a-f0-9]{8}$/)
    expect(chunks).toEqual([
      {
        chunkId: chunks[0].chunkId,
        pageIndex: 0,
        text: "第一段。\n\n第二段。",
        markdown: `### [${chunks[0].chunkId}] Page 1\n\n第一段。\n\n第二段。`,
        rects: [],
        coordinateVersion: 1,
      },
    ])
  })

  it("converts pdf.js text item rectangles into normalized page coordinates", () => {
    const item = {
      str: "财富公式",
      width: 200,
      height: 20,
      transform: [20, 0, 0, 20, 100, 700],
      dir: "ltr",
      fontName: "g_test",
      hasEOL: true,
    } satisfies TextItem
    const viewport = {
      width: 600,
      height: 800,
      convertToViewportRectangle: ([x0, y0, x1, y1]: [number, number, number, number]) => [
        x0,
        800 - y0,
        x1,
        800 - y1,
      ],
    }

    expect(textItemToNormalizedRect(0, item, viewport)).toEqual({
      pageIndex: 0,
      x0: 100 / 600,
      y0: 80 / 800,
      x1: 300 / 600,
      y1: 100 / 800,
    })
  })

  it("builds browser-preview chunks with text item geometry", () => {
    const textContent = {
      items: [
        {
          str: "复利",
          width: 40,
          height: 10,
          transform: [10, 0, 0, 10, 10, 180],
          dir: "ltr",
          fontName: "g_test",
          hasEOL: false,
        },
        {
          str: "来自时间",
          width: 80,
          height: 10,
          transform: [10, 0, 0, 10, 55, 180],
          dir: "ltr",
          fontName: "g_test",
          hasEOL: true,
        },
      ],
      styles: {},
    } as unknown as TextContent
    const viewport = {
      width: 200,
      height: 200,
      convertToViewportRectangle: ([x0, y0, x1, y1]: [number, number, number, number]) => [
        x0,
        200 - y0,
        x1,
        200 - y1,
      ],
    }

    const blocks = textContentToBlocks(textContent, 0, viewport)
    const chunks = buildChunks(
      [
        {
          pageIndex: 0,
          text: "复利 来自时间",
          markdown: pageToMarkdown(1, "复利 来自时间"),
        },
      ],
      new Map([[0, blocks]]),
    )

    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe("复利 来自时间")
    expect(chunks[0].rects).toEqual([
      {
        pageIndex: 0,
        x0: 10 / 200,
        y0: 10 / 200,
        x1: 135 / 200,
        y1: 20 / 200,
      },
    ])
  })

  it("reports extraction progress after each PDF page", async () => {
    const makePage = (text: string) => ({
      getViewport: () => ({
        width: 200,
        height: 200,
        convertToViewportRectangle: ([x0, y0, x1, y1]: [number, number, number, number]) => [
          x0,
          200 - y0,
          x1,
          200 - y1,
        ],
      }),
      getTextContent: async () =>
        ({
          items: [
            {
              str: text,
              width: 40,
              height: 10,
              transform: [10, 0, 0, 10, 10, 180],
              dir: "ltr",
              fontName: "g_test",
              hasEOL: true,
            },
          ],
          styles: {},
        }) as unknown as TextContent,
    })
    const pdf = {
      numPages: 2,
      getPage: vi.fn(async (pageNumber: number) =>
        makePage(pageNumber === 1 ? "第一页" : "第二页"),
      ),
    }
    const onProgress = vi.fn()

    const parsed = await extractPdfText(pdf as never, { onProgress })

    expect(parsed.pages).toHaveLength(2)
    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      pageNumber: 1,
      totalPages: 2,
      percent: 50,
    })
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      pageNumber: 2,
      totalPages: 2,
      percent: 100,
    })
  })
})
