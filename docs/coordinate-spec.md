# 坐标系统规范

> 本文是框选、解析、检索引用回跳的底层契约。任何引擎坐标进入或离开系统，都必须经过本文定义的显式转换函数，并配套单测。

## 1. 唯一规范空间

本项目只有一个持久化坐标规范空间：

**归一化 PDF 页坐标 `NormalizedPageRect`**

- 原点：页面左上角。
- 范围：`x0/y0/x1/y1` 均在 `0..1`。
- 方向：`x` 向右增大，`y` 向下增大。
- 页码：内部使用 `page_index`，从 `0` 开始；展示给用户时再转成 `page_number = page_index + 1`。
- 矩形约束：`x0 <= x1`，`y0 <= y1`，宽高必须大于 0。

```ts
type NormalizedPageRect = {
  pageIndex: number
  x0: number
  y0: number
  x1: number
  y1: number
}
```

持久化高亮、解析块、引用跳转全部使用这个空间。PDF 引擎、DOM、MinerU、pdf.js 的原始坐标都不是持久化真相。

## 2. 锚点纪律

选区锚点按以下优先级存储：

1. `ScaledPosition` / `NormalizedPageRect[]`：几何真相，用于稳定绘制和回退。
2. `TextQuoteSelector { exact, prefix, suffix }`：语义桥，用于重解析后模糊重锚。
3. `TextPositionSelector { start, end }`：仅提示，绝不作为耐久真相。

pdf.js 字符偏移量可能随版本、文本层参数和字体切分漂移，不能作为数据库里的长期锚点依据。

## 3. DOM / pdf.js 视口转换

前端框选来自 `Range.getClientRects()`，坐标先转成页容器内的 CSS 像素，再转规范空间：

```text
page_x0 = client_rect.left   - page_rect.left
page_y0 = client_rect.top    - page_rect.top
page_x1 = client_rect.right  - page_rect.left
page_y1 = client_rect.bottom - page_rect.top

norm_x0 = page_x0 / viewport_width
norm_y0 = page_y0 / viewport_height
norm_x1 = page_x1 / viewport_width
norm_y1 = page_y1 / viewport_height
```

画回页面时反向转换：

```text
page_x = norm_x * viewport_width
page_y = norm_y * viewport_height
```

要求：

- `viewport_width/height` 必须来自用户实际看到的 pdf.js 页面容器，而不是 PDF 原始 point 尺寸。
- 缩放只改变视口尺寸，不改变规范坐标。
- 旋转页必须先由 pdf.js 视口完成显示变换，持久化前仍落到左上原点的页面规范空间。

## 4. MinerU `middle.json` 转换

MinerU 坐标真相只取 `middle.json`（zip 里通常名为 `layout.json`），不直接使用 `content_list.json` 或 `model.json` 作为渲染坐标。

已用 `财富公式.pdf` 实测：`middle.json` 的 `bbox` 是 PDF points，配合每页 `page_size = [width, height]`，原点为左上角，`y` 向下，无需翻转。

转换公式：

```text
norm_x0 = bbox[0] / page_size[0]
norm_y0 = bbox[1] / page_size[1]
norm_x1 = bbox[2] / page_size[0]
norm_y1 = bbox[3] / page_size[1]
```

约束：

- 必须 clamp 到 `0..1`，并拒绝空矩形。
- 必须保留 `page_index`。
- `content_list.json` 的 bbox 是 `0..1000` 归一化空间，只能作为内容辅助，不可混入 `middle.json` point 坐标。
- 旋转页只接受 `0/90/180/270` 度；使用 `topLeftPointsToNormalizedWithRotation` / `top_left_points_to_normalized_with_rotation` 将未旋转的左上点坐标映射到显示页空间。`90/270` 时显示页宽高互换。
- CropBox 不等于 MediaBox 时，若输入 bbox 已确认处在同一左上点坐标系内，使用 `topLeftPointsInCropBoxToNormalized` / `top_left_points_in_crop_box_to_normalized`，先减去 CropBox 左上偏移再按 CropBox 宽高归一化。
- MinerU 云端旋转页/CropBox 回投仍需真实样本验收；现有代码已把数学契约和单元测试固化，避免解析层隐式猜测。

## 5. PDF point 转换

桌面端解析坐标来自 MinerU `middle.json/layout.json`。若遇到 PDF 原生底左原点坐标（例如某些低层 PDF box 或 QuadPoints），必须先转左上原点：

```text
top_left_y0 = page_height - pdf_y1
top_left_y1 = page_height - pdf_y0
```

转换函数命名必须体现原点，例如 `pdfBottomLeftPointsToNormalized`，避免隐式猜测。

## 6. 数据库字段建议

解析块：

```text
chunk_id text primary key
book_id text not null
page_index integer not null
rects_json text not null -- NormalizedPageRect[]
text text not null
engine text not null -- mineru | ...
engine_version text
coordinate_version integer not null
```

高亮锚点：

```text
highlight_id text primary key
book_id text not null
rects_json text not null
quote_exact text not null
quote_prefix text
quote_suffix text
position_start integer -- hint only
position_end integer   -- hint only
pdfjs_version text
coordinate_version integer not null
```

当前 `coordinate_version = 1`。

## 7. 必测清单

- MinerU `bbox/page_size` 能得到预期规范矩形。
- 规范矩形画回不同缩放尺寸后比例不变。
- 输入坐标自动排序并 clamp，但空矩形被拒绝。
- 跨页选区拆成多个 `NormalizedPageRect`，每个矩形保留自己的 `page_index`。
- 底左原点 PDF point 能正确翻转为左上规范坐标。
- 旋转 `90/180/270` 页的左上点 bbox 能映射到显示页规范空间。
- CropBox 偏移样本能先减裁切框偏移再归一化。
