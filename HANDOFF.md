# HANDOFF · 交接给开发(Codex)的第一文档

> 读这一份就能上手。它告诉你:**项目是什么、我们已经做了什么、形成了哪些经过验证的认识、你接手后从哪里开始、有哪些坑必须避开。**
> 写于规划阶段结束、开发阶段开始之际(2026-05-31)。规划由 Claude Code 完成,开发主力是你(Codex)。

---

## 0. 30 秒理解这个产品

**框选精读**:一个 PC 桌面 app(macOS 优先),用户导入任意 PDF,像微信读书一样阅读,**框选任意段落/句子**,AI 以这段为锚点、**主动 planning 并检索全书证据**,给出带可点击引用的深度解读。

差异化:现有"和 PDF 聊天"产品都是整篇塞进去做全局问答,理解浅、浪费了"框选"这个最强意图信号。我们 = **微信读书的选段交互 × agentic RAG 深度解读**。

---

## 1. 我们做了什么(规划阶段成果)

1. **确立产品定位与市场判断**(`PLANNING.md` §1):痛点真实、踩中 agentic RAG 风口、差异化清晰。
2. **完成技术选型并经多智能体调研 + 对抗式验证**——几个想当然的假设被推翻(见 §3 的"认识")。
3. **两个最大技术风险已用真实数据清掉**:
   - ✅ MinerU 解析 + 坐标(用 `财富公式.pdf` 跑通端到端,脚本 `scripts/mineru_e2e.py`)
   - ✅ DeepSeek LLM 连通(OpenAI 兼容)
4. **产出全套规范文档**(见 §6 文档地图)。
5. **确定开发分工**:你(Codex)写 Rust 核心/解析编排/坐标转换/agentic 循环;Claude Code 写 React 前端/UI/文档。

**最新代码状态(2026-06-01)**:已经不是“只有文档”的状态。当前已有 Tauri/React 桌面原型、Rust 后端解析/索引/RAG 核心、SQLite 本地库、MinerU 客户端、LLM/embedding 设置页、阅读器交互和测试套件。桌面端 PDF 解析统一走 MinerU；旧 PyMuPDF/pypdf sidecar 已移除。继续接手时以当前 worktree 为准，不要按旧规划从零初始化项目。

---

## 2. 技术栈(一句话 + 详表见 `docs/tech-stack.md`)

`Tauri v2(Rust 核心)+ React/TS/Vite + shadcn/ui + Tailwind 前端 + pdf.js 渲染 + MinerU 解析 + SQLite FTS/provider 向量检索 + 多 provider LLM(默认 DeepSeek)`

---

## 3. 已形成的关键认识(为什么这样设计 —— 经验证,不是拍脑袋)

这些是规划阶段最值钱的产出,**每一条都直接影响你怎么写代码,务必内化**:

### 3.1 框选锚点:几何为真相,引用为桥,偏移仅提示 ⚠️ 最重要
- **pdf.js 的字符偏移量不是可靠的耐久锚点**(对抗式验证推翻):文本项边界是启发式的,跨渲染/版本/参数会漂移;pdf.js 自己的高亮功能都不用偏移量,用几何 QuadPoints。
- **正确方案**:存几何 `ScaledPosition`(真相)+ `TextQuoteSelector`(语义桥,`diff-match-patch` 模糊重定位)+ `TextPositionSelector`(仅提示)。详见 `PLANNING.md` §7。
- **绝不**把字符偏移量当耐久锚点写进数据库。

### 3.2 坐标只有一个规范空间 = 归一化 PDF 页坐标(0..1)⚠️ 头号 bug 来源
- 任何引擎(pdf.js / MinerU)进出都必须经显式转换函数 + 单测。
- **✅ 已实测**:MinerU `middle.json`(=zip 内 `layout.json`)的 bbox 是 PDF points,配每页 `page_size`,`bbox/page_size` 换算后**原点为左上角、y 不翻转,与 pdf.js 渲染空间天然对齐**。这清掉了原"头号风险"。
- ⚠️ **仍需补验**:MinerU 云端解析产物里的旋转页(vlm 的 `angle` 字段)和 CropBox≠MediaBox 的边缘 PDF 回投。当前代码已做到:块级 `angle` 非 0 时不再假装精确,整本 `coordinate_mode` 标记为 `normalized-page-rects-approx-angle`,UI 显示“近似”但仍允许点击/解读。
- ⚠️ 注意 **content_list.json 的 bbox 是 0–1000 归一化**,middle.json 才是 PDF points,别搞混。

### 3.3 PDF 解析:桌面端统一走 MinerU
- 所有桌面端导入走 MinerU(`api/v4` 精度版,**不是** Agent 版——Agent 版只返回 markdown 没坐标)。
- **异步流程**:`file-urls/batch` 取预签名链接 → PUT 上传 → 轮询 → 下载解压。详见 `docs/mineru-integration.md`。
- **配额 1000 页/天、≤200MB/≤200 页**:解析结果一次性缓存本地 SQLite,重开不重解析;>200 页用 `page_ranges` 分批。
- 切块前**过滤 `header`/`page_number` 噪音块**(实测每页各一个)。

### 3.4 LLM:多 provider 可配置,引用统一 chunk_id
- 默认 DeepSeek(已实测),可切 OpenAI/Anthropic。DeepSeek+OpenAI 共用 OpenAI 兼容适配器,Anthropic 独立。
- **引用统一用 chunk_id**(不依赖 Claude 原生 Citations):检索块带 `[chunk_id]` → 模型在解读里标注 → 后处理成可点击引用 → 跳回书页高亮。三家代码一致。详见 `docs/llm-provider.md`。

### 3.5 agentic RAG:选中段落是不可动摇的焦点
- 不是把整本塞进去,而是模型用 `search_book` 等工具主动检索全书,迭代 2–4 轮。
- 每轮重钉逐字选中段落;焦点漂移是主要风险。详见 `PLANNING.md` §5。

### 3.6 移动端:不要 Tauri 一统天下
- Tauri v2 移动端是 GA 但有坑(updater 仅桌面、WebView 碎片化)。把 RAG/解析/向量写成**框架无关的 Rust 核心**,未来移动端用 RN/Expo 薄壳经 FFI 复用核心。**PC 阶段就要保持核心与 UI 解耦。**

---

## 4. 你(Codex)接手后从哪里开始

按 `ROADMAP.md` 的“当前实现状态”继续推进。**不要重新搭骨架**，优先补真实桌面 E2E、MinerU 云端回归、发布级体验和性能缺口。

### 已完成的地基

- Tauri v2 + React/TS/Vite + Tailwind/shadcn + Storybook。
- 坐标 spec、Rust/TS 转换函数、MinerU 常规页坐标回投验证。
- PDF → TXT/Markdown/chunks 转换，桌面 SQLite/资产持久化，浏览器预览 IndexedDB。
- FTS5 + 外部 provider embedding 混合检索；embedding 默认预置 SiliconFlow `https://api.siliconflow.cn/v1/embeddings`、`Qwen/Qwen3-Embedding-4B`、2560 维，API Key 只在 `.env` 后端读取；embedding provider/model/dim 不匹配会要求重嵌；provider 超时/失败时保留 FTS 文本检索并跳过向量增强。
- 多 provider LLM 后端抽象、agentic RAG 工具循环、统一 `[chunk_id]` 引用。
- MinerU `angle` 非 0 的坐标近似标记、阅读器“近似”提示，以及高亮列表默认回到转换稿、PDF 仅作为校对入口。
- MinerU 长 PDF 已按 `page_ranges` 分批，进度事件和阅读器状态栏会显示第几批/总批数/页码范围；仍需真实 500+ 页样本压测性能和内存。
- 后端级读书链路 E2E 已覆盖:生成临时转换稿 → 保存 TXT/MD/PDF assets → FTS 搜索 → 高亮保存/恢复 → 初始解读与追问历史恢复。
- 设置页已有“产品自检”:使用临时 PDF 和临时 SQLite 跑 PDF→TXT/MD/chunks、FTS 搜索、离线解读引用、追问继承锚点、高亮/历史持久化；自检不调用外部 LLM/embedding provider,不污染真实书库。设置按钮/自检按钮有稳定 `data-testid`,便于下一步窗口级 E2E 自动化。
- 解读卡片会明确提示当前是浏览器预览兜底还是桌面端后端 RAG,避免把浏览器预览误判成产品静态不可用。
- 发布健康检查脚本已接入:`pnpm health` 串行跑 Rust fmt、前端测试、Rust lib 测试、前端生产构建和密钥扫描；`pnpm health:bundle` 额外生成 debug `.app`，并调用包内 `Contents/MacOS/focused-reading --product-self-check` 验证核心读书链路。storage 测试资产目录已隔离，避免并发测试互相删除同一 `converted-books` 目录。

### 下一步优先级

- 真实 Tauri 窗口 E2E:导入一本真实 PDF,验证转换、搜索、框选/深度解读、追问、引用跳转、高亮/历史保存、重开恢复；设置页产品自检可先作为快速健康检查。
- MinerU 当前 token 云端 E2E + 旋转/CropBox 回投样本。
- 大 PDF 性能和内存压测；长书分批进度 UI 已有，下一步用真实 500+ 页 PDF 验收。
- 发布前 Storybook 状态覆盖、设备矩阵、签名/公证/DMG 分发。当前 debug `.app` 可打包；`pnpm tauri build --debug --bundles dmg --verbose` 在本机卡在 create-dmg 的 Finder/AppleScript 布局阶段，需发布阶段单独处理或改用非 Finder 依赖的分发包。

---

## 5. 必须遵守的铁律(详见 `AGENTS.md`,这里是高频的)

1. 坐标只有一个规范空间;跨引擎必经显式转换 + 单测;改坐标代码前先读 `docs/coordinate-spec.md`。
2. 锚点:几何为真相,引用为桥,偏移仅提示。绝不把 pdf.js 偏移量当耐久锚点。
3. embedding 只走外部 provider,不本地部署模型;DB 存 provider/model+维度,切换即重嵌。
4. MinerU 坐标真相 = `middle.json`(bbox/page_size 换算),不用 content_list 的 0–1000 直接当渲染坐标。
5. 引用统一 chunk_id,不依赖厂商 Citations(Anthropic Citations 仅 V2 增强)。
6. **所有密钥(MinerU token / LLM key)只走 Rust 后端,绝不进前端代码、绝不打包进客户端**。
7. 解析结果缓存本地,不重复消耗 MinerU 配额。
8. 前端用 shadcn 组件名沟通;新组件必须建枚举全状态的 Storybook。
9. 核心逻辑(解析/RAG/向量)与 UI 解耦,为移动端复用铺路。
10. pre-1.0 / 外部接口依赖锁精确版本(向量检索走外部 provider,不引入本地向量库 sqlite-vec)。

---

## 6. 文档地图(按这个顺序读)

| 顺序 | 文档 | 内容 |
|---|---|---|
| 1 | **HANDOFF.md**(本文件) | 上手第一读 |
| 2 | `PLANNING.md` | 产品定位 + 技术架构 + agentic RAG 设计 + **§7 锚点(必读)** + 风险表 |
| 3 | `docs/tech-stack.md` | 完整技术栈 + 数据流 + 开发分工 |
| 4 | `ROADMAP.md` | 分阶段可执行任务(你的工作清单) |
| 5 | `docs/mineru-integration.md` | MinerU API 集成规范(接口/坐标/配额/安全/已实测结论) |
| 6 | `docs/llm-provider.md` | LLM 多 provider 设计(DeepSeek/OpenAI/Anthropic) |
| 7 | `UI-UX.md` | 设计语言 + 用 shadcn 组件名描述的每个界面 |
| 8 | `AGENTS.md` | 多 agent 协作铁律(全文务必读) |

---

## 7. 现状清单(你能看到什么)

```
产品代码: src/、src-tauri/src/、scripts/
文档:    PLANNING / ROADMAP / UI-UX / AGENTS + docs/*
验证脚本: scripts/mineru_e2e.py、scripts/secret_scan.sh
测试 PDF: 0_book/*.pdf(财富公式.pdf 是主测试文件,163 页干净中文数字版)
本地数据: data/ 可能含 SQLite、转换资产、MinerU 缓存；不要提交
密钥:    .env(被 .gitignore 保护；密钥只后端读取)
```

---

## 8. 给用户的安全待办(转告)

⚠️ **MinerU token 和 DeepSeek key 都曾出现在规划对话记录中,建议重新生成后更新 `.env`**:
- MinerU: https://mineru.net/apiManage
- DeepSeek: DeepSeek 控制台

---

## 9. 一句话给 Codex

地基已勘探清楚、最大的两个技术风险已用真实数据验证通过、规范齐备。**你接手的是一个'已知可行、就差实现'的项目**。最该小心的是**坐标与锚点**(§3.1、§3.2)——这是全产品最难、最容易埋深坑的地方,规划已经给了确定解法,照着做、写好单测、先 spike 后码业务。开工吧。
