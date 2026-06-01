# 框选精读

一个基于 Tauri + React 的桌面 PDF 精读应用。用户导入 PDF 后，可以框选任意段落，应用会以框选内容为锚点检索全书证据，并调用 LLM 生成带引用的深度解读。

> 与"和 PDF 聊天"类产品（整篇塞进上下文做全局问答）的区别：本产品把**框选段落**当作一等公民的意图入口，AI 以这段为锚点、主动 planning 并 agentic 检索全书证据，给出带可点击引用的深度解读。

## 架构

### 分层

桌面端是一个 Tauri v2 应用：React/TS 前端负责渲染与交互，Rust 后端负责解析、索引、检索、LLM 编排和所有密钥处理。核心逻辑（解析/RAG/坐标/向量）刻意与 UI 解耦，为未来移动端薄壳复用铺路。

```
┌─────────────────────────── 前端 (src/, React + TS + Vite) ───────────────────────────┐
│  components/   reader 阅读器 · interpretation 解读卡片 · settings 设置 · ui (shadcn)    │
│  pdf/          pdf.js 渲染 + 框选(几何坐标 + 文本引用锚点)                              │
│  core/         端无关纯逻辑:锚点/坐标/引用/解读会话/选区 → chunk 映射(含完整单测)      │
│  stores/       zustand 阅读与解读会话状态                                              │
└───────────────────────────────────────┬───────────────────────────────────────────────┘
                                         │  Tauri IPC (invoke / event)
┌────────────────────────────────────────┴──────────────────────── 后端 (src-tauri/src/, Rust) ──┐
│  mineru / mineru_parser   云端 PDF 解析 + middle.json 坐标回投(唯一坐标真相)               │
│  coordinates              唯一规范坐标空间 = 归一化 PDF 页坐标,跨引擎进出必经显式转换         │
│  storage                  SQLite:书/chunk/高亮/锚点/解读历史 + FTS5 全文索引 + 向量表       │
│  embeddings               外部 OpenAI-compatible provider 向量化(密钥仅后端)              │
│  llm                      多 provider 抽象(DeepSeek 默认 / OpenAI / Anthropic)            │
│  interpretation           agentic RAG 循环:框选段落钉死焦点 + search_book 等工具迭代检索   │
│  zotero / translation     从本地 Zotero 导入 PDF · 译文辅助                                │
│  commands.rs              ~40 个 Tauri command,前端唯一入口                                │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 核心数据流

```
导入 PDF
 → [Rust] 统一调用 MinerU api/v4 精度版解析
 → [Rust] 从 middle.json 取块 bbox(PDF points)+ page_size,bbox/page_size 换算到归一化页坐标
           (MinerU angle 非 0 的旋转块标记为「近似」)
 → [Rust] 过滤 header/page_number 噪音块 → 切块入库:FTS5 全文索引
           + 若配置 embedding provider,限时调外部 /embeddings 写入向量表
 → [前端 pdf.js] 渲染原版 PDF,用户框选 → 记录几何 ScaledPosition + 文本引用锚点
 → [前端→Rust→LLM] 框选段落为焦点 → agentic 循环(2–4 轮 search_book/get_chunk/get_neighbors)
                    → 返回带 [chunk_id] 标注的解读
 → [前端] 解读卡片渲染 + 把 [chunk_id] 后处理成可点击引用 → 点击跳回书页高亮
           高亮 / 解读历史持久化到 SQLite
```

### 关键技术决策

经一轮多智能体调研 + 对抗式验证后确定，每条都直接影响代码（详见 `docs/` 与 `PLANNING.md`）：

- **锚点：几何为真相，引用为桥，偏移仅提示。** pdf.js 字符偏移量不是耐久锚点（跨渲染/版本会漂移），存几何 `ScaledPosition`（真相）+ `TextQuoteSelector`（diff-match-patch 模糊重定位）+ `TextPositionSelector`（仅提示）。
- **坐标只有一个规范空间** = 归一化 PDF 页坐标（0..1），是头号 bug 来源；跨引擎（pdf.js / MinerU）进出必经显式转换函数 + 单测。坐标真相 = MinerU `middle.json`，**不是** `content_list.json` 的 0–1000。
- **桌面端统一走 MinerU 解析**，覆盖公式/表格/多栏/OCR；解析结果缓存本地 SQLite，不重复消耗配额。旧的 PyMuPDF/pypdf 本地兜底已移除。
- **引用统一用 chunk_id**：检索块带 `[chunk_id]` → 模型标注 → 后处理成可点击引用，三家 LLM provider 代码一致，**不依赖厂商原生 Citations**。
- **检索 = FTS5 + 外部 provider 向量混合**；向量表存 provider/model/dim，切换即重嵌；provider 超时/失败时降级为纯 FTS，不阻断。embedding 不在客户端本地部署模型。
- **所有密钥（MinerU token / LLM key / embedding key）只走 Rust 后端**，仅从 `.env` 读取，绝不进前端代码、绝不打包进客户端。

### 技术栈一览

| 层 | 选择 |
|---|---|
| 桌面框架 | Tauri v2（Rust 核心 + WebView） |
| 前端 | React 19 + TypeScript + Vite + Tailwind + shadcn/ui + zustand |
| 组件走查 | Storybook（枚举全状态） |
| PDF 渲染 + 框选 | pdf.js |
| PDF 解析 + 坐标 | MinerU API `api/v4` |
| 本地存储 | SQLite（`rusqlite`，bundled） |
| 检索 | SQLite FTS5 + 外部 provider 向量混合 |
| Embedding | 外部 OpenAI-compatible provider（默认 SiliconFlow Qwen3） |
| LLM | 多 provider：DeepSeek（默认）/ OpenAI / Anthropic |

> 详细技术栈与选型依据见 `docs/tech-stack.md`；坐标规范见 `docs/coordinate-spec.md`；MinerU 集成见 `docs/mineru-integration.md`；LLM 多 provider 设计见 `docs/llm-provider.md`。

## 启动前准备

需要先安装：

- Node.js 22+
- pnpm
- Rust stable
- Tauri v2 所需系统依赖

首次安装依赖：

```bash
pnpm install
```

## 配置 API Key

复制环境变量模板：

```bash
cp .env.example .env
```

然后编辑 `.env`，填入你自己的密钥。`.env` 已被 `.gitignore` 忽略，不要提交到 GitHub。

### 必填：MinerU

用于云端 PDF 解析，尤其是论文、扫描件、公式、表格、多栏版式。

```bash
MINERU_API_TOKEN=你的_MinerU_token
```

请从 MinerU API 文档/管理页获取自己的 API Token：`https://mineru.net/apiManage/docs`

MinerU 精准解析 API 需要 Token。本项目使用该 Token 调用后端解析接口，不要把 Token 写进前端代码或提交到 GitHub。

### 必填：LLM Provider

默认使用 DeepSeek：

```bash
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的_DeepSeek_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

也可以切换到 OpenAI：

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=你的_OpenAI_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5-mini
```

或 Anthropic：

```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=你的_Anthropic_key
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_MODEL=claude-sonnet-4-5
```

只需要配置当前 `LLM_PROVIDER` 对应的一组 key。

### 可选：Embedding Provider

Embedding 用于向量检索。当前预置 SiliconFlow + Qwen3：

```bash
EMBEDDING_PROVIDER=siliconflow
EMBEDDING_API_KEY=你的_embedding_provider_key
EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1/embeddings
EMBEDDING_MODEL=Qwen/Qwen3-Embedding-4B
EMBEDDING_DIM=2560
```

如果暂时没有 embedding key，可以关闭向量检索，仅使用本地 FTS 文本检索：

```bash
EMBEDDING_PROVIDER=disabled
EMBEDDING_API_KEY=
```

### 可选：OpenCode Agent Host

内置 agent host 默认沿用上面的 LLM 配置。通常不需要改：

```bash
FOCUSED_READING_OPENCODE_HOST=127.0.0.1
FOCUSED_READING_OPENCODE_PORT=48172
FOCUSED_READING_AGENT_CONFIG_PORT=48174
FOCUSED_READING_BOOK_TOOL_BASE_URL=http://127.0.0.1:48173
FOCUSED_READING_BOOK_TOOL_TOKEN=
```

## 启动开发环境

桌面端开发：

```bash
pnpm tauri dev
```

仅预览前端：

```bash
pnpm dev
```

注意：浏览器预览模式没有 Tauri 后端能力，保存设置、测试 API 连接、MinerU 云端导入等桌面能力需要用 `pnpm tauri dev`。浏览器预览仅保留 pdf.js 内存转换用于界面走查。

## 从 Zotero 导入论文

桌面端顶部提供「从 Zotero 导入」入口。使用前需要满足：

- Zotero 桌面端已经打开。
- Zotero 本地 connector API 可访问，默认地址是 `http://127.0.0.1:23119`。
- Zotero 条目下有本地 PDF 附件，并且 `/items/{attachmentKey}/file` 能返回 `file://` 本地路径。
- 必须用 `pnpm tauri dev` 启动桌面端；浏览器预览没有 Tauri 后端，不能访问本机 Zotero API 或读取本地 PDF 路径。

使用流程：

1. 点击顶部「从 Zotero 导入」。
2. 输入论文标题或关键词。
3. 在候选列表里选择带「PDF 可导入」标记的条目。
4. 应用会读取 Zotero 返回的本地 PDF 路径，然后复用本产品自己的 PDF 转换、索引、阅读和批注流程。

Zotero 在这里只作为文献库和 PDF 路径来源。本产品不会上传 Zotero 元数据，也不会直接修改 Zotero 里的 PDF；批注、阅读进度、chunk、引用和 AI 解读仍保存在本产品的本地书库中。

如果搜索或导入失败，优先检查：

- Zotero 是否正在运行。
- `http://127.0.0.1:23119/api/users/0/items` 是否能在本机访问。
- 目标条目是否真的有本地 PDF 附件，而不是只有网页链接或云端占位。
- PDF 文件是否还存在于 Zotero storage 目录中。

Storybook：

```bash
pnpm storybook
```

运行测试：

```bash
pnpm test
```

## 推送前安全检查

推送到 GitHub 前先运行：

```bash
pnpm secret-scan
```

这个脚本会扫描候选提交文件中的常见 API key、token、私钥形态，只输出命中的文件名，不打印密钥内容。

以下内容默认不会提交：

- `.env` 和 `.env.*`
- 本地 PDF：`0_book/`、`*.pdf`
- MinerU 解析结果和本地索引：`data/`
- 本地缓存：`cache/`
- 保存的运行时设置：`llm-settings.json`
- 依赖和构建产物：`node_modules/`、`.venv/`、`dist/`、`storybook-static/`、`src-tauri/target/`

如果你曾经把真实 key 写进聊天记录、截图、文档或提交历史，建议到对应平台重新生成 key 后再推送。

## 相关文档

上手第一读 `HANDOFF.md`，再按需展开：

| 文档 | 内容 |
|---|---|
| `HANDOFF.md` | 交接/上手第一文档：做了什么、关键认识、从哪开始、坑在哪 |
| `PLANNING.md` | 产品定位 + 技术架构 + agentic RAG 设计 + §7 锚点（必读）+ 风险表 |
| `ROADMAP.md` | 当前实现状态 + 分阶段可执行任务 |
| `AGENTS.md` | 多 agent 协作铁律 |
| `UI-UX.md` | 设计语言 + 前端工程约定 |
| `docs/tech-stack.md` | 完整技术栈 + 数据流 + 开发分工 |
| `docs/coordinate-spec.md` | 坐标系统规范（头号 bug 来源） |
| `docs/mineru-integration.md` | MinerU API 集成规范（接口/坐标/配额/安全） |
| `docs/llm-provider.md` | LLM 多 provider 设计（DeepSeek/OpenAI/Anthropic） |
| `docs/zotero-integration.md` | Zotero 本地导入集成 |
| `docs/validation-checklist.md` | 发布前验收清单 |
| `docs/archive/` | 历史快照（如 `REVIEW.md`），非常驻文档 |
