import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { MarkdownContent } from "./MarkdownContent"

describe("MarkdownContent images", () => {
  it("renders sanitized raw HTML tables as real tables", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        allowRawHtml
        content={
          "<table><tr><td>Method</td><td>Ratio(%)</td></tr><tr><td>SSTP</td><td>60</td></tr></table>"
        }
      />,
    )

    expect(html).toContain("<table")
    expect(html).toContain("<td")
    expect(html).toContain("Method")
    expect(html).not.toContain("&lt;table")
  })

  it("keeps local MinerU image URLs in converted markdown", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        allowRawHtml
        content={
          "![figure](file:///tmp/book/images/figure%201.jpg)\n\n" +
          '<img src="file:///tmp/book/images/raw%20figure.png" alt="raw" />'
        }
      />,
    )

    expect(html).toContain('src="file:///tmp/book/images/figure%201.jpg"')
    expect(html).toContain('src="file:///tmp/book/images/raw%20figure.png"')
    expect(html).toContain('alt="figure"')
    expect(html).toContain('alt="raw"')
  })

  it("keeps Tauri asset image URLs but does not allow script URLs", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        allowRawHtml
        content={
          "![asset](asset://localhost/tmp/book/images/figure.jpg)\n\n" +
          "![asset-host](http://asset.localhost/tmp/book/images/figure.jpg)\n\n" +
          "![bad](javascript:alert(1))"
        }
      />,
    )

    expect(html).toContain('src="asset://localhost/tmp/book/images/figure.jpg"')
    expect(html).toContain('src="http://asset.localhost/tmp/book/images/figure.jpg"')
    expect(html).not.toContain("javascript:alert")
    expect(html).not.toContain('alt="bad"')
  })
})
