import { Check, RotateCcw } from "lucide-react"
import { useEffect, useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import type { ReaderDisplayTheme, ReaderDisplayThemeId } from "./reader-display-theme"
import {
  readerColorModeOptions,
  type ReaderColorMode,
} from "./reader-color-mode"
import {
  readerFontScaleSteps,
  readerLineHeightSteps,
  readerPageWidthSteps,
  type ReaderTypographyOverrides,
} from "./reader-typography"

export type ReaderAppearanceControlProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  displayThemeId: ReaderDisplayThemeId
  displayThemeItems: ReaderDisplayTheme[]
  colorMode: ReaderColorMode
  typography: ReaderTypographyOverrides
  hasTypographyOverride: boolean
  onDisplayThemeChange: (id: ReaderDisplayThemeId) => void
  onColorModeChange: (mode: ReaderColorMode) => void
  onTypographyChange: <K extends keyof ReaderTypographyOverrides>(
    key: K,
    value: ReaderTypographyOverrides[K],
  ) => void
  onResetTypography: () => void
}

/**
 * 顶栏「Aa」阅读外观浮层:排版(字号/行距/页宽)+ 明暗三态 + 阅读主题,
 * 合并为唯一入口。纯展示组件,状态经 props 流入,与 ReaderTopBar 风格一致
 * (reader-floating-surface 浮层 + 外部 pointerdown 关闭)。
 */
export function ReaderAppearanceControl({
  open,
  onOpenChange,
  displayThemeId,
  displayThemeItems,
  colorMode,
  typography,
  hasTypographyOverride,
  onDisplayThemeChange,
  onColorModeChange,
  onTypographyChange,
  onResetTypography,
}: ReaderAppearanceControlProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return
      }
      onOpenChange(false)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [open, onOpenChange])

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        className="reader-chrome-icon-button inline-flex h-7 w-7 items-center justify-center rounded-md text-[13px] font-semibold leading-none transition-colors duration-100 focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="阅读外观"
        aria-haspopup="menu"
        aria-expanded={open}
        title="阅读外观:字号 / 行距 / 页宽 / 明暗 / 主题"
        data-testid="reader-display-theme-button"
        onClick={() => onOpenChange(!open)}
      >
        Aa
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="阅读外观"
          className="reader-floating-surface absolute right-0 top-8 z-50 w-72 overflow-hidden rounded-md border shadow-lg"
          data-testid="reader-display-theme-menu"
        >
          <div className="max-h-[70vh] overflow-y-auto p-3">
            <AppearanceSection title="外观">
              <SegmentedControl
                ariaLabel="明暗模式"
                options={readerColorModeOptions.map((option) => ({
                  id: option.id,
                  label: option.label,
                }))}
                value={colorMode}
                onChange={(value) => onColorModeChange(value as ReaderColorMode)}
              />
            </AppearanceSection>

            <AppearanceSection
              title="排版"
              action={
                hasTypographyOverride ? (
                  <button
                    type="button"
                    className="reader-floating-muted inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors duration-100 hover:text-[color:var(--reader-panel-text)] focus:outline-none focus:ring-2 focus:ring-ring"
                    data-testid="reader-typography-reset"
                    onClick={onResetTypography}
                  >
                    <RotateCcw className="h-3 w-3" />
                    恢复默认
                  </button>
                ) : null
              }
            >
              <ControlRow label="字号">
                <SegmentedControl
                  ariaLabel="字号"
                  allowClear
                  options={readerFontScaleSteps.map((step) => ({
                    id: step.id,
                    label: step.label,
                  }))}
                  value={typography.fontScale}
                  onChange={(value) =>
                    onTypographyChange("fontScale", value as ReaderTypographyOverrides["fontScale"])
                  }
                />
              </ControlRow>
              <ControlRow label="行距">
                <SegmentedControl
                  ariaLabel="行距"
                  allowClear
                  options={readerLineHeightSteps.map((step) => ({
                    id: step.id,
                    label: step.label,
                  }))}
                  value={typography.lineHeight}
                  onChange={(value) =>
                    onTypographyChange("lineHeight", value as ReaderTypographyOverrides["lineHeight"])
                  }
                />
              </ControlRow>
              <ControlRow label="页宽">
                <SegmentedControl
                  ariaLabel="页宽"
                  allowClear
                  options={readerPageWidthSteps.map((step) => ({
                    id: step.id,
                    label: step.label,
                  }))}
                  value={typography.pageWidth}
                  onChange={(value) =>
                    onTypographyChange("pageWidth", value as ReaderTypographyOverrides["pageWidth"])
                  }
                />
              </ControlRow>
              <p className="reader-floating-muted mt-1.5 text-[11px] leading-4">
                未设置的项跟随当前主题默认值,切换主题不会重置这里的选择。
              </p>
            </AppearanceSection>

            <AppearanceSection title="阅读主题">
              <div className="-mx-1">
                {displayThemeItems.map((item) => {
                  const selected = item.id === displayThemeId
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={cn(
                        "reader-floating-item flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-100",
                        selected && "reader-floating-item-active",
                      )}
                      onClick={() => onDisplayThemeChange(item.id)}
                    >
                      <span className="reader-panel-accent mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                        {selected ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className="reader-panel-text block text-xs font-medium">
                          {item.label}
                          {item.sourceName !== "current" ? (
                            <span className="reader-floating-muted ml-1 font-normal">
                              {item.sourceName}
                            </span>
                          ) : null}
                        </span>
                        <span className="reader-floating-muted mt-0.5 block text-[11px] leading-4">
                          {item.description}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </AppearanceSection>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AppearanceSection({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-t border-[color:var(--reader-panel-border)] py-2.5 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="reader-floating-muted text-[11px] font-semibold uppercase tracking-wide">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function ControlRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="reader-panel-muted mb-1 text-[11px]">{label}</div>
      {children}
    </div>
  )
}

type SegmentOption = { id: string; label: string }

function SegmentedControl({
  ariaLabel,
  options,
  value,
  onChange,
  allowClear = false,
}: {
  ariaLabel: string
  options: SegmentOption[]
  value: string | null
  onChange: (value: string | null) => void
  /** 允许再次点击当前项以清除(回到跟随主题默认)。 */
  allowClear?: boolean
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex items-stretch gap-1 rounded-md bg-[color:var(--reader-panel-hover-bg)] p-0.5"
    >
      {options.map((option) => {
        const selected = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected}
            className={cn(
              "flex-1 rounded px-1.5 py-1 text-center text-[11px] font-medium transition-colors duration-100 focus:outline-none focus:ring-2 focus:ring-ring",
              selected
                ? "bg-[color:var(--reader-panel-active-bg)] text-[color:var(--reader-panel-active-text)]"
                : "reader-panel-muted hover:text-[color:var(--reader-panel-text)]",
            )}
            onClick={() => onChange(allowClear && selected ? null : option.id)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
