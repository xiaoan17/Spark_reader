# MinerU 集成规范

> 基于 MinerU 开放 API 官方文档(`https://mineru.net/apiManage/docs`)+ 输出格式参考(`https://opendatalab.github.io/MinerU/reference/output_files/`)核实而成,非猜测。
> Token 存于项目根 `.env` 的 `MINERU_API_TOKEN`(已 gitignore)。
> ⚠️ 当前 token 曾出现在对话中,建议在 https://mineru.net/apiManage 重新生成。

---

## 0. 为什么用 MinerU(架构决策变更)

原 PLANNING 方案是"本地抽取 + 复杂版式自己处理"。引入 MinerU 开放 API 后:

- ✅ **一个 API 搞定四类内容**:论文公式(LaTeX)、表格(HTML)、多栏、扫描 OCR——质量远高于自己拼本地解析+OCR。
- ✅ **关键:它给出我们框选锚点要的坐标**——`middle.json` 每块带 `bbox`(PDF points)+ 每页 `page_size`,能直接接进我们的"归一化 PDF 页坐标"规范空间(见 §4)。
- ⚖️ **权衡**:PDF 内容会发往 MinerU 服务器(隐私);异步(提交→轮询);有配额(1000 页/天高优先级);≤200MB、≤200 页/文件。
- 🔁 **当前产品决策**:桌面端统一走 MinerU；不再保留本地 PyMuPDF/pypdf sidecar 兜底。浏览器预览里的 pdf.js 文本抽取仅用于无后端 UI 走查，不作为桌面解析路径。

**最终分工**:MinerU = 唯一桌面解析引擎;pdf.js = 前端显示+选择。

---

## 1. 用哪套 API

MinerU 有两套:

| | 精度版 `api/v4` | 轻量 Agent 版 `api/v1` |
|---|---|---|
| 鉴权 | **Bearer token** | 无 token,按 IP 限流 |
| 输出 | **完整 zip**(md + middle.json + content_list.json + model.json) | **仅 markdown** |
| 文件 | ≤200MB / ≤200 页 | ≤10MB / ≤20 页 |
| 坐标 | ✅ 有 bbox+page_idx | ❌ 只有 markdown,无坐标 |

→ **必须用精度版 `api/v4`**,因为只有它返回带坐标的 `middle.json`/`content_list.json`。Agent 版无坐标,对框选锚点无用。

base host:`https://mineru.net`

---

## 2. 解析流程(异步:提交 → 轮询)

### 2.1 本地文件上传路径(我们的主路径,用户从本地拖入 PDF)

桌面 app 的 PDF 来自用户本地,不是公网 URL,所以走**预签名上传**(批量接口,单文件也用它):

```
1. POST /api/v4/file-urls/batch
   Header: Authorization: Bearer <MINERU_API_TOKEN>
   Body: 申请预签名上传链接 + 解析参数(is_ocr/enable_formula/enable_table/language/page_ranges)
   → 返回 { batch_id, file_urls: [presigned_put_url, ...] }

2. PUT 文件二进制 到 presigned_put_url
   (链接约 24h 有效;无需 Content-Type 头;上传后系统自动提交解析)

3. 轮询 GET /api/v4/extract-results/batch/{batch_id}
   → 每个文件 state: pending|running|converting|done|failed
   running 时带 extract_progress { extracted_pages, total_pages, start_time }
   done 时带 full_zip_url(CDN zip 下载链接)

4. 下载并解压 full_zip_url
   → full.md / *_middle.json(即 layout.json)/ *_content_list.json / *_model.json
```

下载结果 zip 时后端强制 `https`、校验 host 属于 `mineru.net` 或 `MINERU_ALLOWED_ZIP_HOSTS` 追加白名单,并检查响应像 zip 后才进入解压防护。

> 单文件 URL 路径 `POST /api/v4/extract/task`(传公网 `url`)仅用于"解析网络上的 PDF"场景,本地文件用不上。

### 2.2 轮询策略

- 指数退避:起始 2s,封顶 10s;`running` 时按 `extract_progress` 估算。
- 超时:>200 页文件可能数分钟;设宽松超时 + 进度回传前端(接 `[finish]20260531_UI-UX.md` 导入进度条)。
- 失败:读 `err_msg`/错误码(见 §6),分类重试 vs 报错。

---

## 3. 解析参数(精度版)

| 参数 | 默认 | 我们的用法 |
|---|---|---|
| `model_version` | — | `vlm`(质量高,带 `angle` 旋转字段)或 `pipeline`。**默认 vlm**,pipeline 作对照。 |
| `is_ocr` | `false` | 文本层探测判定为扫描版时设 `true` |
| `enable_formula` | `true` | 论文场景保持 true |
| `enable_table` | `true` | 保持 true |
| `language` | `ch` | 中文书默认 `ch`;按书设(`en`/`japan`/`korean`/…) |
| `page_ranges` | 全部 | 形如 `"2,4-6"`;>200 页书需分批(见 §5) |

---

## 4. 坐标规范(框选锚点的命脉)⚠️

**这是整个集成最关键的部分。不同文件的 bbox 约定不同,选错会导致框选错位。**

| 文件 | bbox 格式 | 单位/范围 | 原点 |
|---|---|---|---|
| `content_list.json` | `[x0,y0,x1,y1]` | **归一化 0–1000** | top-left(隐含) |
| `middle.json`(=zip 里的 `layout.json`) | `[x0,y0,x1,y1]` | **PDF points**(原始页坐标) | **✅ 实测 top-left,y 不翻转** |
| `model.json`(pipeline) | `[x0,y0,x1,y1]` | 像素 | — |
| `model.json`(vlm) | `[x0,y0,x1,y1]` | 归一化 `[0,1]` 百分比 | **明确 top-left** |

> **✅ 已用真实文件验证(2026-05-31, `财富公式.pdf`, backend=hybrid v3.1.11)**:zip 里的 `layout.json` 即 middle.json。第0页 `page_size=[595,841]`,书名块 bbox `[67,63,359,80]` → 归一化 `[0.113,0.075,...]`,y 从顶部 0.075 起 → **原点确认为左上角,与 pdf.js 渲染空间天然对齐,无需 y 翻转**。这清掉了原"头号风险"。MinerU 云端产物仍需对**旋转页(vlm `angle`)和 CropBox≠MediaBox** 边缘 PDF 补真实回投验收。当前代码对块级 `angle` 非 0 的 MinerU 输出采用保守策略:仍按 `bbox/page_size` 生成可用近似 rect,但整本 `coordinate_mode` 标记为 `normalized-page-rects-approx-angle`,前端显示“近似”。

**我们的决策:以 `middle.json`(zip 内名为 `layout.json`)为坐标真相来源。** 理由:它每块带 `bbox`(PDF points)+ 每页 `page_size: [width,height]`,直接换算进归一化页空间;`content_list.json`(阅读序扁平文本)作为切块的辅助。

**换算到规范空间(归一化 PDF 页坐标 0..1):**
```
norm_x0 = bbox[0] / page_size[0]
norm_y0 = bbox[1] / page_size[1]
norm_x1 = bbox[2] / page_size[0]
norm_y1 = bbox[3] / page_size[1]
```
- ✅ **原点经验验证已完成**:对 `财富公式.pdf` 已确认 middle/layout bbox 是 top-left,无需 y 翻转。
- ⚠️ **CropBox/Rotate**:MinerU 云端产物的 `page_size` 是否等于 pdf.js viewport 尺寸仍需真实样本回投验收；旋转页(vlm 的 `angle` 字段)目前先显式标记为近似,避免把未验证坐标当精确锚点。

**middle.json 块层级**(用于切块):
```
pdf_info[].preproc_blocks / para_blocks
  Level1 (table|image|chart): {type, bbox, blocks}
  Level2: {type, bbox, lines}        type ∈ text|title|list|index|interline_equation|...
    Line: {bbox, spans}
      Span: {bbox, type, content|image_path}   type ∈ text|inline_equation|interline_equation|table|...
```

---

## 5. 配额与限制(影响产品设计)

| 限制 | 值 | 应对 |
|---|---|---|
| 高优先级配额 | **1000 页/天/账号** | 超出降级低优先级(更慢)。前端提示;长书警示页数消耗。 |
| 单文件大小 | ≤200MB | 超限前端拦截 |
| 单文件页数 | ≤200 页 | **>200 页的书必须用 `page_ranges` 分批多次提交**,前端拼接 |
| 批量 | ≤200 文件,单请求 ≤50 URL | 一次导入多书时分批 |

→ **产品含义**:解析有成本(页数配额)和延迟(异步分钟级)。设计上:(a) 解析是一次性的,结果缓存到本地 SQLite,重开不重解析;(b) 长书分批 + 进度可视;(c) 临近配额给用户提示。

---

## 6. 错误码

| 码 | 含义 | 应对 |
|---|---|---|
| `A0202` | token 错误 | 检查 `.env` token |
| `A0211` | token 过期 | 重新生成 token(当前 token `exp` 约 2026 年中) |
| `-60005` | 超大小限制 | 前端拦截 |
| `-60006` | 超页数限制 | 走 `page_ranges` 分批 |

---

## 7. 安全约定

- Token **只存 `.env`**,经 Tauri Rust 后端读取并发起请求,**绝不进前端代码/不打包进客户端**(否则可被逆向提取)。
- 长期看,若做商业分发:应在**自己的服务端**代理 MinerU 调用,客户端不持有 MinerU token(避免每个用户客户端都揣着你的 key)。MVP 单机自用阶段可本地 `.env`。
- 此 token 已在对话中暴露,**尽快重新生成一个**。

---

## 8. 接入 Phase 0 的 spike

- [x] **MinerU 端到端 spike**:已用真实 token 对 `财富公式.pdf` 走完提交→轮询→下载 zip→解析 middle/layout.json。
- [x] **坐标回投 spike(头号风险)**:已确认 MinerU 常规页面 bbox top-left、无需 y 翻转。
- [ ] **MinerU 边缘坐标回投**:补真实旋转页/CropBox PDF 样本。
