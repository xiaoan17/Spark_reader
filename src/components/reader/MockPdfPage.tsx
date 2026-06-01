import { minerUBboxToNormalized, normalizedToViewportRect, rectToCss } from "@/core/coordinates"
import type { NormalizedPageRect } from "@/core/coordinates"
import { SelectionToolbar } from "@/components/selection/SelectionToolbar"

type MockPdfPageProps = {
  selectionRects: NormalizedPageRect[]
}

const pageSize = { width: 595, height: 841 }
const viewport = { width: 595, height: 841 }
const minerUHeading = minerUBboxToNormalized(0, [67, 63, 359, 80], pageSize)

export function MockPdfPage({ selectionRects }: MockPdfPageProps) {
  return (
    <div className="relative mx-auto h-[841px] w-[595px] bg-[#fbfaf5] shadow-md">
      <div className="absolute inset-0 px-[72px] py-[82px] font-reading text-[18px] leading-[34px] text-neutral-900">
        <h1 className="mb-12 text-center text-2xl font-semibold">财富公式</h1>
        <p>
          投资并不是寻找一个神奇答案，而是在漫长时间里不断校正自己的行为。市场每天都在变化，
          但人的冲动和恐惧却反复出现。
        </p>
        <p className="mt-5">
          复利的力量并不来自某一次惊人的收益，而来自足够长的时间里持续保持正确方向。它要求人们少做破坏性的事，
          同时允许微小的优势不断累积。
        </p>
        <p className="mt-5">
          因此，真正重要的问题不是下一次机会在哪里，而是你能否建立一种不会被短期波动轻易击穿的系统。
        </p>
      </div>

      <Highlight rect={minerUHeading} className="border border-teal-700/50 bg-transparent" />
      {selectionRects.map((rect, index) => (
        <Highlight key={index} rect={rect} className="bg-teal-300/40" />
      ))}

      {selectionRects.length > 0 ? (
        <SelectionToolbar className="absolute left-[90px] top-[258px] z-10" />
      ) : null}
    </div>
  )
}

function Highlight({
  rect,
  className,
}: {
  rect: NormalizedPageRect
  className: string
}) {
  const viewportRect = normalizedToViewportRect(rect, viewport)

  return (
    <div
      className={`pointer-events-none absolute rounded-sm ${className}`}
      style={rectToCss(viewportRect)}
    />
  )
}
