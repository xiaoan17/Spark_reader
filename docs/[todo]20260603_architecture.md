# 架构设计与设计思路

> 这份文档面向加入或对接本项目的工程师,讲清楚**框选精读**是怎么搭的、为什么这么搭。读完应该能回答:数据从哪来到哪去、坐标和锚点为什么是核心难点、AI 解读这一环到底在做什么。

## 1. 一句话定位

桌面 PDF 精读应用:用户**框选任意段落**,AI 以这段为锚点,agentic 检索全书证据,生成**带可点击引用**的深度解读。

和"和 PDF 聊天"(整篇塞进上下文做全局问答)的根本区别——**意图入口不同**:
- 聊天类:用户问什么,模型答什么,焦点在「问题」。
- 框选精读:用户框选一段,模型主动 planning「这段在说什么、和全书哪些地方呼应」,焦点钉死在「这段文本」上。框选是一等公民。

这个定位决定了下面所有技术选择。

## 2. 分层架构

桌面端是一个 Tauri v2 应用。**前端只管渲染与交互,后端管解析、索引、检索、LLM 编排和所有密钥**。核心逻辑(解析/RAG/坐标/向量)刻意与 UI 解耦,为未来移动端薄壳复用铺路。

```
┌──────────────────────── 前端 (src/, React 19 + TS + Vite) ────────────────────────┐
│  components/   reader 阅读器 · interpretation 解读卡片 · settings · ui (shadcn)     │
│  pdf/          pdf.js 渲染 + 框选(几何坐标 + 文本引用锚点)                          │
│  core/         端无关纯逻辑:锚点/坐标/引用/解读会话/选区→chunk 映射(含完整单测)    │
│  stores/       zustand 阅读与解读会话状态                                          │
└───────────────────────────────────┬────────────────────────────────────────────────┘
                                     │  Tauri IPC (invoke / event)
┌────────────────────────────────────┴──────────────────── 后端 (src-tauri/src/, Rust) ──┐
│  mineru / mineru_parser   云端 PDF 解析 + middle.json 坐标回投(唯一坐标真相)        │
│  coordinates              唯一规范坐标空间 = 归一化 PDF 页坐标,进出必经显式转换      │
│  storage                  SQLite:书/chunk/高亮/锚点/解读历史 + FTS5 + 向量表        │
│  embeddings               外部 OpenAI-compatible provider 向量化(密钥仅后端)        │
│  llm                      多 provider 抽象(DeepSeek 默认 / OpenAI / Anthropic)      │
│  interpretation           agentic RAG 循环:框选钉死焦点 + search_book 等工具迭代检索 │
│  zotero / translation     从本地 Zotero 导入 PDF · 译文辅助                          │
│  commands.rs              ~40 个 Tauri command,前端唯一入口                          │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**为什么这样分层:**
- **密钥安全是硬约束**——所有 API key(MinerU / LLM / embedding)只在 Rust 侧从 `.env` 读取,绝不进前端 bundle。WebView 里能拿到的东西都视为可泄露,所以凡是带密钥的网络调用一律在 Rust 发起。
- **核心逻辑端无关**——`src/core/` 和 `src-tauri/src/` 里的解析/坐标/检索逻辑不依赖任何 UI 框架,将来做移动端时 UI 重写、核心复用。

## 3. 核心数据流

```
导入 PDF
 → [Rust] 统一调用 MinerU api/v4 精度版解析
 → [Rust] 从 middle.json 取块 bbox(PDF points)+ page_size
           → 换算到归一化页坐标(angle≠0 的旋转块标记「近似」)
 → [Rust] 过滤 header/page_number 噪音 → 切块入库:FTS5 全文索引
           + 若配置 embedding provider,限时调外部 /embeddings 写入向量表
 → [前端 pdf.js] 渲染原版 PDF,用户框选 → 记录几何 ScaledPosition + 文本引用锚点
 → [前端→Rust→LLM] 框选段落为焦点 → agentic 循环(2–4 轮 search_book/get_chunk/get_neighbors)
                    → 返回带 [chunk_id] 标注的解读
 → [前端] 解读卡片渲染 + 把 [chunk_id] 后处理成可点击引用 → 点击跳回书页高亮
           高亮 / 解读历史持久化到 SQLite
```

## 4. 三个最难的设计点

这是整个产品工程上最反直觉、也最值得同伴先理解的三处。每一处都直接影响代码,改之前务必先读对应 `docs/`。

### 4.1 锚点:几何为真相,引用为桥,偏移仅提示

**问题**:框选一段文字,怎么"记住"它的位置,使得下次打开、换台机器、pdf.js 升版后还能精确定位回去并高亮?

**踩过的坑**:pdf.js 的字符偏移量(text offset)看起来最直接,但它**不是耐久锚点**——渲染管线、字体回退、pdf.js 版本变化都会让同一段文字的偏移漂移。

**决策**(三层冗余):
- **几何 `ScaledPosition`(真相)**——归一化页坐标里的矩形,这是定位的最终依据。
- **`TextQuoteSelector`(桥)**——存框选文本及其前后文,用 diff-match-patch 做模糊重定位,几何对不上时靠它救回。
- **`TextPositionSelector`(仅提示)**——字符偏移只当加速提示,绝不当唯一真相。

详见 `docs/[finish]20260531_coordinate-spec.md`。

### 4.2 坐标:只有一个规范空间

**坐标是本项目的头号 bug 来源。** pdf.js 和 MinerU 各有自己的坐标系、原点、单位、Y 轴方向。

**铁律**:
- **唯一规范空间 = 归一化 PDF 页坐标(0..1)**。
- 任何引擎(pdf.js / MinerU)的坐标进出这个空间,**必经显式转换函数 + 单测**,不允许就地手算。
- **坐标真相 = MinerU `middle.json`** 里的 bbox(PDF points)+ page_size,**不是** `content_list.json` 的 0–1000 整数坐标。
- MinerU `angle≠0` 的旋转块标记为「近似」,不假装精确。

详见 `docs/[finish]20260531_coordinate-spec.md`。

### 4.3 引用:统一用 chunk_id,不依赖厂商 Citations

**问题**:要让 AI 解读里的每个论据都可点击跳回原文,引用机制怎么做才能跨三家 LLM 一致?

**决策**:
- 检索出的每个块都带 `[chunk_id]` 标记喂给模型。
- 模型在生成解读时用 `[chunk_id]` 标注论据来源。
- 后处理把 `[chunk_id]` 渲染成可点击引用,点击 → 用该 chunk 的几何坐标跳回书页高亮。
- **不依赖** OpenAI/Anthropic 各自的原生 Citations 能力——那样三家代码会分叉。chunk_id 方案让 DeepSeek/OpenAI/Anthropic 走同一套代码。

## 5. AI 解读:agentic RAG 而非一次性塞上下文

框选段落 = **钉死的焦点**,不随对话漂移。后端的 `interpretation` 模块跑一个 agentic 循环(典型 2–4 轮):

1. 以框选段落为锚,模型决定要检索什么。
2. 调工具:`search_book`(混合检索)/ `get_chunk`(取指定块)/ `get_neighbors`(取上下文相邻块)。
3. 拿到证据后判断够不够,不够再来一轮。
4. 收敛后产出带 `[chunk_id]` 的解读。

**检索 = FTS5 + 外部 provider 向量混合**:
- 向量表记录 provider/model/dim,**切换 embedding 即重嵌**。
- embedding **只走外部 OpenAI-compatible provider,不在客户端本地部署模型**。
- provider 超时/失败时**降级为纯 FTS 文本检索,不阻断**主流程。

详见 `docs/[todo]20260531_llm-provider.md`。Agent 引擎现状见 `docs/[todo]20260707_稳健化-Obsidian-Agent引擎计划.md` C 节(Codex 引擎);旧 OpenCode 方案已废弃,仅存 `docs/archive/20260602_opencode-agent.md` 作历史参考。

## 6. 解析:统一走 MinerU

**决策**:桌面端统一用 MinerU `api/v4` 精度版解析,覆盖公式/表格/多栏/OCR。旧的 PyMuPDF/pypdf 本地兜底**已移除**。

**理由**:本地解析在论文、扫描件、复杂版式上质量不可控,而坐标和切块质量直接决定后续检索与引用精度。解析结果缓存进本地 SQLite,**不重复消耗 MinerU 配额**。

详见 `docs/[todo]20260531_mineru-integration.md`。

## 7. 存储

单个本地 SQLite(`rusqlite`,bundled)承载全部:书 / chunk / 高亮 / 锚点 / 解读历史 + FTS5 全文索引 + 向量表。所有用户数据本地化,不上云。

## 8. 给同伴的上手建议

1. 先读本文档建立全局观。
2. 想动坐标/锚点相关代码 → **必读** `docs/[finish]20260531_coordinate-spec.md`,这里最容易引入隐蔽 bug。
3. 想动检索/解读 → 读 `docs/[todo]20260531_llm-provider.md` + `docs/[todo]20260531_mineru-integration.md`。
4. 前端唯一入口是 `src-tauri/src/commands.rs` 的 ~40 个 Tauri command,从这里能反查每条数据流。
5. 改任何带密钥的逻辑前,记住铁律:**密钥只在 Rust,绝不进前端**。
6. 推送前跑 `pnpm secret-scan`。

## 9. 技术栈速查

| 层 | 选择 |
|---|---|
| 桌面框架 | Tauri v2(Rust 核心 + WebView) |
| 前端 | React 19 + TypeScript + Vite + Tailwind + shadcn/ui + zustand |
| 组件走查 | Storybook |
| PDF 渲染 + 框选 | pdf.js |
| PDF 解析 + 坐标 | MinerU API `api/v4` |
| 本地存储 | SQLite(`rusqlite`,bundled) |
| 检索 | SQLite FTS5 + 外部 provider 向量混合 |
| Embedding | 外部 OpenAI-compatible provider(默认 SiliconFlow Qwen3) |
| LLM | 多 provider:DeepSeek(默认)/ OpenAI / Anthropic |
