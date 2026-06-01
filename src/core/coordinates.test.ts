import { describe, expect, it } from "vitest"
import {
  minerUBboxToNormalized,
  normalizedToViewportRect,
  pdfBottomLeftPointsToNormalized,
  topLeftPointsInCropBoxToNormalized,
  topLeftPointsToNormalizedWithRotation,
  viewportRectToNormalized,
} from "./coordinates"

describe("coordinate conversions", () => {
  it("converts MinerU middle.json points to normalized top-left coordinates", () => {
    expect(
      minerUBboxToNormalized(0, [67, 63, 359, 80], { width: 595, height: 841 }),
    ).toEqual({
      pageIndex: 0,
      x0: 67 / 595,
      y0: 63 / 841,
      x1: 359 / 595,
      y1: 80 / 841,
    })
  })

  it("keeps normalized coordinates stable across viewport scales", () => {
    const rect = {
      pageIndex: 2,
      x0: 0.1,
      y0: 0.2,
      x1: 0.4,
      y1: 0.5,
    }

    expect(normalizedToViewportRect(rect, { width: 1000, height: 2000 })).toEqual({
      left: 100,
      top: 400,
      right: 400,
      bottom: 1000,
    })
    expect(normalizedToViewportRect(rect, { width: 500, height: 1000 })).toEqual({
      left: 50,
      top: 200,
      right: 200,
      bottom: 500,
    })
  })

  it("converts DOM client rects through the visible page viewport", () => {
    expect(
      viewportRectToNormalized(
        1,
        { left: 120, top: 240, right: 360, bottom: 540 },
        { left: 100, top: 200 },
        { width: 800, height: 1000 },
      ),
    ).toEqual({
      pageIndex: 1,
      x0: 0.025,
      y0: 0.04,
      x1: 0.325,
      y1: 0.34,
    })
  })

  it("flips bottom-left PDF points into the normalized top-left space", () => {
    expect(
      pdfBottomLeftPointsToNormalized(0, [10, 20, 110, 120], {
        width: 200,
        height: 400,
      }),
    ).toEqual({
      pageIndex: 0,
      x0: 0.05,
      y0: 0.7,
      x1: 0.55,
      y1: 0.95,
    })
  })

  it("rejects empty rectangles after clamping", () => {
    expect(() =>
      minerUBboxToNormalized(0, [100, 100, 100, 200], {
        width: 595,
        height: 841,
      }),
    ).toThrow(/positive width/)
  })

  it("rotates top-left point boxes into the displayed page space", () => {
    const pageSize = { width: 200, height: 400 }
    const bbox = [10, 20, 110, 120] as const

    expect(topLeftPointsToNormalizedWithRotation(0, bbox, pageSize, 90)).toEqual({
      pageIndex: 0,
      x0: 280 / 400,
      y0: 10 / 200,
      x1: 380 / 400,
      y1: 110 / 200,
    })
    expect(topLeftPointsToNormalizedWithRotation(0, bbox, pageSize, 180)).toEqual({
      pageIndex: 0,
      x0: 90 / 200,
      y0: 280 / 400,
      x1: 190 / 200,
      y1: 380 / 400,
    })
    expect(topLeftPointsToNormalizedWithRotation(0, bbox, pageSize, 270)).toEqual({
      pageIndex: 0,
      x0: 20 / 400,
      y0: 90 / 200,
      x1: 120 / 400,
      y1: 190 / 200,
    })
  })

  it("normalizes top-left point boxes inside a CropBox", () => {
    expect(
      topLeftPointsInCropBoxToNormalized(
        0,
        [60, 120, 160, 220],
        [50, 100, 250, 500],
      ),
    ).toEqual({
      pageIndex: 0,
      x0: 10 / 200,
      y0: 20 / 400,
      x1: 110 / 200,
      y1: 120 / 400,
    })
  })

  it("rejects unsupported rotation angles", () => {
    expect(() =>
      topLeftPointsToNormalizedWithRotation(
        0,
        [10, 20, 110, 120],
        { width: 200, height: 400 },
        45,
      ),
    ).toThrow(/unsupported page rotation/)
  })
})
