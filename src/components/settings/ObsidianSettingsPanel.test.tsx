import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { ObsidianSettingsPanel } from "./ObsidianSettingsPanel"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const baseProps = {
  vaultPath: "",
  subdir: "",
  configured: false,
  onVaultPathChange: () => undefined,
  onSubdirChange: () => undefined,
  onSave: () => undefined,
  onClose: () => undefined,
}

describe("ObsidianSettingsPanel", () => {
  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(<ObsidianSettingsPanel {...baseProps} open={false} />)
    expect(html).toBe("")
  })

  it("shows the default subdir placeholder and an unconfigured badge", () => {
    const html = renderToStaticMarkup(<ObsidianSettingsPanel {...baseProps} open />)
    expect(html).toContain("Obsidian 导出")
    expect(html).toContain("Vault 路径")
    expect(html).toContain("框选精读")
    expect(html).toContain("未配置")
    expect(html).not.toContain("已配置")
  })

  it("shows a configured badge and current values", () => {
    const html = renderToStaticMarkup(
      <ObsidianSettingsPanel
        {...baseProps}
        open
        vaultPath="/vault"
        subdir="精读"
        configured
      />,
    )
    expect(html).toContain("已配置")
    expect(html).toContain('value="/vault"')
    expect(html).toContain('value="精读"')
  })

  it("surfaces the error message", () => {
    const html = renderToStaticMarkup(
      <ObsidianSettingsPanel
        {...baseProps}
        open
        status="error"
        message="Obsidian vault 不存在。"
      />,
    )
    expect(html).toContain("Obsidian vault 不存在。")
  })

  it("invokes onSave when the save button is clicked", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const onSave = vi.fn()

    await act(async () => {
      root.render(<ObsidianSettingsPanel {...baseProps} open onSave={onSave} />)
      await Promise.resolve()
    })

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("保存 Obsidian"),
    )
    expect(saveButton).toBeTruthy()

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(onSave).toHaveBeenCalledTimes(1)
    root.unmount()
    container.remove()
  })

  it("disables inputs and the save button while saving", () => {
    const html = renderToStaticMarkup(
      <ObsidianSettingsPanel {...baseProps} open status="saving" />,
    )
    // Two inputs + the save button carry the disabled attribute while saving.
    expect(html.match(/disabled/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })
})
