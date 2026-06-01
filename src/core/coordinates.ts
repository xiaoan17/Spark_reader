export const COORDINATE_VERSION = 1

export type NormalizedPageRect = {
  pageIndex: number
  x0: number
  y0: number
  x1: number
  y1: number
}

export type PageSize = {
  width: number
  height: number
}

export type ClientRectLike = {
  left: number
  top: number
  right: number
  bottom: number
}

export type MinerUBbox = readonly [number, number, number, number]

const EPSILON = 1e-9

export function normalizeRect(input: NormalizedPageRect): NormalizedPageRect {
  assertFinite(input.pageIndex, "pageIndex")
  if (!Number.isInteger(input.pageIndex) || input.pageIndex < 0) {
    throw new Error(`pageIndex must be a non-negative integer: ${input.pageIndex}`)
  }

  const x0 = clamp01(Math.min(input.x0, input.x1))
  const x1 = clamp01(Math.max(input.x0, input.x1))
  const y0 = clamp01(Math.min(input.y0, input.y1))
  const y1 = clamp01(Math.max(input.y0, input.y1))

  if (x1 - x0 <= EPSILON || y1 - y0 <= EPSILON) {
    throw new Error("normalized rect must have positive width and height")
  }

  return {
    pageIndex: input.pageIndex,
    x0,
    y0,
    x1,
    y1,
  }
}

export function minerUBboxToNormalized(
  pageIndex: number,
  bbox: MinerUBbox,
  pageSize: PageSize,
): NormalizedPageRect {
  return topLeftPointsToNormalized(pageIndex, bbox, pageSize)
}

export function topLeftPointsToNormalized(
  pageIndex: number,
  bbox: MinerUBbox,
  pageSize: PageSize,
): NormalizedPageRect {
  assertPageSize(pageSize)

  return normalizeRect({
    pageIndex,
    x0: bbox[0] / pageSize.width,
    y0: bbox[1] / pageSize.height,
    x1: bbox[2] / pageSize.width,
    y1: bbox[3] / pageSize.height,
  })
}

export function topLeftPointsToNormalizedWithRotation(
  pageIndex: number,
  bbox: MinerUBbox,
  pageSize: PageSize,
  rotationDegrees: number,
): NormalizedPageRect {
  assertPageSize(pageSize)
  const rotation = normalizeRotation(rotationDegrees)
  const displaySize = rotatedPageSize(pageSize, rotation)
  const xs: number[] = []
  const ys: number[] = []
  for (const x of [bbox[0], bbox[2]]) {
    for (const y of [bbox[1], bbox[3]]) {
      const [rotatedX, rotatedY] = rotateTopLeftPoint(x, y, pageSize, rotation)
      xs.push(rotatedX)
      ys.push(rotatedY)
    }
  }

  return normalizeRect({
    pageIndex,
    x0: Math.min(...xs) / displaySize.width,
    y0: Math.min(...ys) / displaySize.height,
    x1: Math.max(...xs) / displaySize.width,
    y1: Math.max(...ys) / displaySize.height,
  })
}

export function topLeftPointsInCropBoxToNormalized(
  pageIndex: number,
  bbox: MinerUBbox,
  cropBox: MinerUBbox,
): NormalizedPageRect {
  const [left, top, right, bottom] = orderedBox(cropBox)
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) {
    throw new Error(`crop box size must be positive: ${width}x${height}`)
  }

  return normalizeRect({
    pageIndex,
    x0: (bbox[0] - left) / width,
    y0: (bbox[1] - top) / height,
    x1: (bbox[2] - left) / width,
    y1: (bbox[3] - top) / height,
  })
}

export function viewportRectToNormalized(
  pageIndex: number,
  rect: ClientRectLike,
  pageRect: Pick<ClientRectLike, "left" | "top">,
  viewport: PageSize,
): NormalizedPageRect {
  assertPageSize(viewport)

  return normalizeRect({
    pageIndex,
    x0: (rect.left - pageRect.left) / viewport.width,
    y0: (rect.top - pageRect.top) / viewport.height,
    x1: (rect.right - pageRect.left) / viewport.width,
    y1: (rect.bottom - pageRect.top) / viewport.height,
  })
}

export function normalizedToViewportRect(
  rect: NormalizedPageRect,
  viewport: PageSize,
): ClientRectLike {
  assertPageSize(viewport)
  const normalized = normalizeRect(rect)

  return {
    left: normalized.x0 * viewport.width,
    top: normalized.y0 * viewport.height,
    right: normalized.x1 * viewport.width,
    bottom: normalized.y1 * viewport.height,
  }
}

export function pdfBottomLeftPointsToNormalized(
  pageIndex: number,
  bbox: MinerUBbox,
  pageSize: PageSize,
): NormalizedPageRect {
  assertPageSize(pageSize)

  const [x0, y0, x1, y1] = bbox
  return normalizeRect({
    pageIndex,
    x0: x0 / pageSize.width,
    y0: (pageSize.height - y1) / pageSize.height,
    x1: x1 / pageSize.width,
    y1: (pageSize.height - y0) / pageSize.height,
  })
}

export function rectToCss(rect: ClientRectLike) {
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.right - rect.left}px`,
    height: `${rect.bottom - rect.top}px`,
  }
}

function clamp01(value: number) {
  assertFinite(value, "coordinate")
  return Math.min(1, Math.max(0, value))
}

function assertPageSize(pageSize: PageSize) {
  assertFinite(pageSize.width, "page width")
  assertFinite(pageSize.height, "page height")

  if (pageSize.width <= 0 || pageSize.height <= 0) {
    throw new Error(`page size must be positive: ${pageSize.width}x${pageSize.height}`)
  }
}

function assertFinite(value: number, name: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite: ${value}`)
  }
}

function normalizeRotation(rotationDegrees: number) {
  assertFinite(rotationDegrees, "rotation")
  if (!Number.isInteger(rotationDegrees)) {
    throw new Error(`rotation must be an integer degree value: ${rotationDegrees}`)
  }
  const normalized = ((rotationDegrees % 360) + 360) % 360
  if (![0, 90, 180, 270].includes(normalized)) {
    throw new Error(`unsupported page rotation: ${rotationDegrees}`)
  }
  return normalized
}

function rotatedPageSize(pageSize: PageSize, rotation: number): PageSize {
  return rotation === 90 || rotation === 270
    ? { width: pageSize.height, height: pageSize.width }
    : pageSize
}

function rotateTopLeftPoint(
  x: number,
  y: number,
  pageSize: PageSize,
  rotation: number,
): [number, number] {
  assertFinite(x, "x")
  assertFinite(y, "y")
  switch (rotation) {
    case 90:
      return [pageSize.height - y, x]
    case 180:
      return [pageSize.width - x, pageSize.height - y]
    case 270:
      return [y, pageSize.width - x]
    default:
      return [x, y]
  }
}

function orderedBox(bbox: MinerUBbox): [number, number, number, number] {
  for (const value of bbox) {
    assertFinite(value, "box coordinate")
  }
  return [
    Math.min(bbox[0], bbox[2]),
    Math.min(bbox[1], bbox[3]),
    Math.max(bbox[0], bbox[2]),
    Math.max(bbox[1], bbox[3]),
  ]
}
