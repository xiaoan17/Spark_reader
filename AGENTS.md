# AGENTS.md · 多 Agent 协作规则

> 本项目用异构 multi-agent 方式开发(方法论见 `[finish]20260531_UI-UX.md` §0)。本文件是给所有参与 agent(Codex / Claude Code / 其他)的工作守则。

---

## 1. 分工(谁干什么)

| Agent | 负责 | 不要让它做 |
|---|---|---|
| **Codex (GPT)** | 架构梳理;PDF 解析管线;agentic RAG 循环逻辑;**坐标转换**(不能遗漏细节的硬骨头);找 bug 真实根因;Rust 核心 | 写前端样式;写简洁文档 |
| **Claude Code (Opus)** | 前端组件与交互;UI 打磨;写文档/总结;中小任务 | 需要不断深入、绝不能遗漏细节的超复杂逻辑 |

> 每次模型更新后重新试探边界——分工不是教条。

---

## 2. 铁律(违反会引入难查的 bug)

1. **坐标只有一个规范空间** = 归一化 PDF 页坐标。任何引擎(pdf.js / MinerU)进出都必须经显式转换函数,且有单测。改坐标相关代码前先读 `docs/[finish]20260531_coordinate-spec.md`。
2. **锚点:几何为真相,引用为桥,偏移仅提示**(见 `_internal/[finish]20260531_PLANNING.md` §7)。绝不把 pdf.js 字符偏移量当耐久锚点。
3. **embedding 模型不可混用**:DB 存模型名+维度,切换即整本重嵌。
4. **绝不缓存整本书 / 绝不缓存 tool_results**:prompt caching 只缓存静态前缀(DeepSeek/OpenAI 自动,Anthropic 显式三断点)。
5. **引用统一用 chunk_id**:所有 LLM provider 走同一套 `[chunk_id]` 引用 + 后处理,**不依赖厂商原生 Citations**(Anthropic Citations 仅 V2 可选增强)。LLM 默认 DeepSeek,三家可切换(见 `docs/[todo]20260531_llm-provider.md`)。
6. **扫描版/OCR 锚点是尽力而为**:UI 必须标注"近似",代码注释必须说明。
7. **pre-1.0 / 外部接口依赖锁版本**:Tauri、rusqlite、MinerU API 版本、各 LLM/embedding provider 模型名锁精确版本,升级要过测试。(注:向量检索走外部 provider,不引入 sqlite-vec/LanceDB 本地向量库。)
8. **MinerU 坐标真相 = `middle.json`**:bbox 经 `bbox/page_size` 换算到归一化页空间;原点方向必须经验验证(见 `docs/[todo]20260531_mineru-integration.md` §4)。**绝不用 `content_list.json` 的 0–1000 或 model.json 像素值直接当渲染坐标。**
9. **MinerU token / LLM key 只走后端**:仅存 `.env`,经 Tauri Rust 后端读取调用,**绝不进前端代码、绝不打包进客户端**。MinerU 解析结果缓存本地,不重复消耗配额。LLM key 同理(DeepSeek/OpenAI/Anthropic)。
10. **Agent 引擎 = Codex(2026-07 起),显式硬边界**:Spark/翻译经 per-request `codex exec --json` 子进程跑,book 工具走 `book_tool_server.rs` 的 `/mcp` 端点(Bearer 鉴权,仅绑 127.0.0.1)。spawn 时**必须**显式传 `--sandbox read-only` + `-c approval_policy="never"` + `-c mcp_servers=...`(整表替换,屏蔽用户全局 MCP)——绝不继承用户 `~/.codex/config.toml` 的 `danger-full-access`。失败自动回退 Rust 进程内管线;`FOCUSED_READING_CODEX_DISABLED=1` 可强制回退。改接线前先跑 `cargo test --lib mcp_codex_live_smoke -- --ignored` 端到端冒烟。
11. **知识层只沉淀,不污染原文、不升级为引用证据**:`kb_cards` / `kb_evidence` 只能从高亮、解读、笔记和抽取候选沉淀;自动流程只能新建/补空,不得覆盖 `user_locked` 或用户正文;最终回答仍必须落回原文 `[chunk_id]`,不得把知识卡 ID 当最终 citation。

---

## 3. 前端约定

1. **用 shadcn/ui 组件名沟通和命名**(见 `[finish]20260531_UI-UX.md` §3)。描述交互说"用 Accordion",别写一长段口语。
2. **新增组件必须建 Storybook**,枚举全状态:正常 / 空 / 加载(Skeleton) / 错误 / 禁用。
   - 解读卡片额外枚举:planning / 检索中 / 流式 / 完成 / API 错误。
   - Story 用 mock 数据,不依赖真实接口。
3. **消灭 `isMobile()` 散布**:纯展示组件与端相关布局分离,核心展示组件做成端无关纯组件(为移动端薄壳复用铺路)。
4. **改完即看**:用 Vite HMR + Storybook 走查,不要每次端到端测样式。

---

## 4. 流程

1. **文档先行**:开新界面/新模块前,先在 `docs/` 写实现方案 spec,对齐后再写代码。
2. **逐阶段**:按 `[todo]20260531_ROADMAP.md` 阶段推进,前一阶段跑通自测再开下一阶段。
3. **改坏兜底**:Storybook 是防止 AI 改坏已有组件的安全网,每次改组件后过一遍相关 story。
4. **用户指定快速验证路径**:用户说"测试/验证/帮我跑一下"且没有额外指定时,默认按以下顺序执行并汇报结果:
   - `pnpm check:reader` — 阅读器/对照翻译快速回归。当前基线(2026-08 实测):3 files,63 tests passed。
   - `pnpm check:quick` — `tsc --noEmit` + 全量前端测试。当前基线(2026-08 实测):69 files,394 tests passed。
   - `pnpm build` — 生产前端构建。
   - `pnpm dev:desktop` — 日常使用/桌面功能验证入口;确认 Vite ready、Tauri dev 编译并启动成功后即可,不要为了日常 UI 调试反复构建 `.app`。

---

## 5. 文档地图

> **新 agent 上手先读 `[todo]20260708_功能补齐与体验提升技术方案.md`(事实上的当前总控)**,再按任务查下面的专项规范。文件名前缀 `[finish]` / `[todo]` 表示文档是否已完成或仍需刷新。已废弃/被取代的文档在 `docs/archive/`,交接与评审历史在 `_internal/`(不进 git)。

**当前总控 / 进行中**
- [todo] `docs/[todo]20260708_功能补齐与体验提升技术方案.md` — 事实上的当前总控:P0/P1 已完成,P2/P3 是 backlog
- [todo] `docs/[todo]20260708_真机走查清单.md` — 待真机执行的走查项(B5/C5 遗留,当前最关键的未闭环项)
- [todo] `docs/[todo]20260707_稳健化-Obsidian-Agent引擎计划.md` — Obsidian 打通 + Agent 引擎(OpenCode→Codex 替换);代码已闭环,仅剩真机遗留
- [todo] `[todo]20260531_ROADMAP.md` — 长期路线图与缺口;"当前实现状态"快照停在 2026-06 已过时,Phase checklist 勾选不可信,参考"缺口"/V2 段即可

**常青规范**
- [finish] `AGENTS.md` — 本文件,协作守则
- [finish] `[finish]20260531_UI-UX.md` — 设计语言 + 前端工程约定
- [finish] `docs/[finish]20260531_coordinate-spec.md` — 坐标系统真相,头号 bug 来源
- [todo] `docs/[todo]20260531_tech-stack.md` — 完整技术栈;需补 Codex 引擎/Obsidian 等新选型
- [todo] `docs/[todo]20260531_mineru-integration.md` — MinerU 开放 API 集成规范;旋转页/CropBox 真实回归仍待补
- [todo] `docs/[todo]20260531_llm-provider.md` — LLM 多 provider 设计;在线回归和缓存观测仍待补
- [todo] `docs/[todo]20260603_architecture.md` — 分层架构与数据流
- [todo] `docs/[todo]20260607_knowledge-system-implementation-plan.md` — 单书知识库任务清单、阶段 check 和验收总控
- [todo] `docs/[todo]20260609_translation-and-spark-implementation.md` — 翻译与 Spark 实现原理(2026-07 起翻译走 Codex 引擎)
- [todo] `docs/[todo]20260601_validation-checklist.md` — 验证操作清单
- `docs/ui/*.md` — 按界面 UI spec,逐份以 `[finish]`/`[todo]` 前缀标注状态
- [finish] `docs/[finish]*.md` 其余交付文档 — zotero 集成 / BRAND / INSTALL-macos / text-ebook-import / 宣传文案

**历史 / 归档**
- [finish] `docs/[finish]20260709_C9-spike-opencode验证记录.md` — OpenCode NO-GO、维持 Codex 的决策证据
- `docs/archive/` — 已废弃方案(OpenCode 两份设计、20260607_开发note_v1 蓝图)
- `_internal/` — 交接/评审/规划历史(HANDOFF/PLANNING/REVIEW),不作为当前入口,不进 git
