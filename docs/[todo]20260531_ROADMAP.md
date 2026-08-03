# 框选精读 · 可执行路线图(ROADMAP)

> 配套文档:`_internal/[finish]20260531_PLANNING.md`(产品+技术架构)、`[finish]20260531_UI-UX.md`(设计语言+前端工程约定)、`AGENTS.md`(多 agent 协作规则)。
> 方法论吸收自 Lody 作者的 AI 前端重构经验(见 `[finish]20260531_UI-UX.md` §0)。
> 当前总控是 `docs/[todo]20260708_功能补齐与体验提升技术方案.md`;本文"当前实现状态"已刷新至 0.1.8(2026-08)。

---

## 当前实现状态(0.1.8,2026-08)

代码已是可日常使用的本地优先桌面产品:

- ✅ Tauri v2 + React 19/TS/Vite + Tailwind/shadcn + Storybook 8.6 + vitest 4 + zustand 5 已建成;微动效用 calligraph。
- ✅ PDF / TXT / EPUB 导入;桌面端统一走 MinerU 解析 + SQLite + 本地资产文件。
- ✅ MinerU 客户端、批量 `page_ranges`、zip 安全解压、`middle.json` 切块、结构化进度事件与长书分批回传;`angle` 非 0 的块标记为近似坐标。
- ✅ SQLite FTS5 + 外部 OpenAI-compatible provider 向量混合检索;向量表存 provider/model/dim 防混用;provider 超时/失败降级为纯 FTS。
- ✅ LLM 多 provider 抽象:DeepSeek(默认 `deepseek-v4-flash`)/ OpenAI / Anthropic;统一 `[chunk_id]` 引用 + 后处理,不依赖厂商原生 Citations。
- ✅ **Agent 引擎 = Codex**(2026-07 起,OpenCode 方案已废弃):Spark 解读、对照翻译、agentic 全书 TLDR 统一经 per-request `codex exec --json` 子进程;book 工具走 `book_tool_server.rs` 的本地 `/mcp` 端点(Bearer 鉴权、仅 127.0.0.1);`responses_bridge.rs` 用 app 配置的 LLM 驱动 codex;失败自动回退 Rust 进程内管线(`FOCUSED_READING_CODEX_DISABLED=1` 强制回退)。
- ✅ reuse-first 缓存层(翻译 / TLDR / embeddings / trace,`storage/mod.rs`);密钥统一走 `config/secret_store.rs`(本地文件 0600 默认,`FOCUSED_READING_SECRET_BACKEND=keychain` opt-in)。
- ✅ 知识体系:`kb_cards` / `kb_evidence` 表 + KnowledgePanel + `search_knowledge` 等命令;只沉淀不污染原文,最终引用仍落 `[chunk_id]`。
- ✅ Obsidian 导出:`obsidian.rs`(原子写、路径逃逸防护)+ 设置页 `ObsidianSettingsPanel`;高亮 / Spark 卡片 / 知识面板三入口。
- ✅ 阅读器 UI:转换稿 / PDF 校对 / 对照翻译 / TLDR / 知识体系多视图、书内搜索、高亮管理、引用跳转、暗色模式、onboarding 向导、模型/embedding 设置页。
- ✅ 产品自检与健康检查:`focused-reading --product-self-check`、`pnpm health` / `pnpm health:bundle`。
- ✅ 发布:`scripts/release_dmg.sh` 可用,已发到 0.1.8(14 个本地 dmg);签名/公证仍未做。
- ✅ 测试基线(2026-08 实测):`pnpm check:reader` = 3 files / 63 tests;`pnpm check:quick` = 69 files / 394 tests;`cargo test --lib` = 216 passed。

还不能宣称"全部完成"的缺口:

- ❗窗口级真实 PDF E2E:导入真实 PDF → 解析 → 搜索 → 框选 → 解读/追问 → 引用跳转 → 保存/重开恢复,需在真实 Tauri 窗口验收。
- ❗MinerU 云端当前 token 的真实 E2E 未重新验收。
- ❗旋转页 / CropBox 的 MinerU 坐标回投回归仍缺真实样本。
- ❗500+ 页大 PDF 真实样本性能/内存压测未完成。
- ❗签名 / 公证未做(本地 dmg 可发,正式分发还差这一步)。
- ❗prompt cache 命中率可观测未做(静态前缀缓存已实现,命中率不可见)。

---

## 0. 工作方法(贯穿所有阶段)

1. **异构 multi-agent 分工**:
   - **Codex(GPT)** 负责:架构梳理、复杂解析/RAG 逻辑、找 bug 真实原因、坐标转换这类"不能遗漏细节"的硬骨头。
   - **Claude Code(Opus)** 负责:写前端组件/交互、写文档、中小任务、磨 UI。
2. **文档/Spec 先行**:每阶段先产出实现方案文档,对齐后再写代码。
3. **逐阶段推进**:前一阶段跑通并自测,再开下一阶段。
4. **组件名描述交互**:统一用 shadcn/ui 组件名沟通(见 `[finish]20260531_UI-UX.md`)。
5. **Storybook 兜底**:每个新组件必须有枚举全状态的 story(见 `AGENTS.md`)。

---

## Phase 0 · 地基与决策固化(0.5–1 周)

**目标:能跑起来一个空壳,所有技术选型在真机上验证可行。**

- [x] 初始化 Tauri v2 项目(`pnpm create tauri-app`,React + TS + Vite)
- [x] 接入 shadcn/ui(`shadcn init`)+ Tailwind + Storybook
- [x] **坐标系统 spike(关键)**:写一个最小 demo——pdf.js 渲染一页 → 框选 → `getClientRects` → 转归一化页坐标 → 画回高亮。验证缩放/旋转下不漂移。
- [ ] ~~**sqlite-vec spike**~~ **已废弃**:向量检索走外部 provider,不引入本地向量库(见 `AGENTS.md` 铁律 7 注)。
- [x] **MinerU 端到端 spike(主解析路径)** ✅ 已通过(2026-05-31,`财富公式.pdf` 163页/124秒)。脚本 `scripts/mineru_e2e.py`。
- [x] **坐标回投 spike(头号风险)** ✅ 实测原点为左上角、y 不翻转,与 pdf.js 天然对齐(见 `docs/[todo]20260531_mineru-integration.md` §4)。待补:旋转页/CropBox 边缘情况。
- [ ] ~~**Claude API spike**~~ **已废弃**:被多 provider 抽象取代(DeepSeek/OpenAI 共用 OpenAI-compatible 适配器 + Anthropic 独立,tool_use/prompt caching 已在适配器层落地,见 `docs/[todo]20260531_llm-provider.md`)。
- [x] 写下 `docs/[finish]20260531_coordinate-spec.md`:钉死唯一规范坐标空间 + 各引擎转换公式(头号 bug 来源,必须先固化)。

**出口标准**:5 个 spike 全绿,坐标 spec 落地。任何一个 spike 红灯都要在这里解决,不带病进 Phase 1。

---

## Phase 1 · 阅读 + 框选锚点(1–2 周)

**目标:能导入 PDF、像微信读书一样读、框选段落并持久化高亮。还没有 AI。**

- [x] PDF 导入 + 渲染(pdf.js)
- [x] 阅读 UI:分页/连续滚动、目录侧栏、阅读进度(见 `[finish]20260531_UI-UX.md` 阅读器布局)
- [x] 框选 → 浮出操作条(shadcn `Popover` / 自定义 floating toolbar)
- [x] **耐久锚点**(`_internal/[finish]20260531_PLANNING.md` §7):
  - [x] 捕获 `ScaledPosition`(几何,真相)
  - [x] 生成 `TextQuoteSelector`(exact + 前后文,自研 `src/core/text-quote-selector.ts`)
  - [x] 存 `TextPositionSelector`(仅提示)
  - [x] 重锚:位置提示 → 引用断言 → 模糊匹配 → 几何回退(`diff-match-patch` 依赖已移除,模糊匹配为自研实现)
- [x] 高亮持久化(SQLite 表:book / highlight / anchor),重开仍在原位
- [x] 高亮管理:列表、删除、跳转

**出口标准**:导入名著 PDF,框选十处,关闭重开后全部精确还原。

---

## Phase 2 · 解析管线 + 本地索引(1–2 周,可与 Phase 1 并行)

**目标:把书解析、切块、建好本地全文索引;配置外部 embedding provider 后补建向量索引,为 RAG 备料。Codex 主导。**

- [x] **MinerU 解析客户端**(Rust 后端):`file-urls/batch` → PUT 上传 → 轮询 → 下载解压 zip。token 经 `.env` 读取(`docs/[todo]20260531_mineru-integration.md`)。
- [x] 解析路由:桌面端统一走 MinerU。文本层探测器(字符数+U+FFFD 率)只用于决定 `is_ocr`。
- [x] 解析结果一次性缓存到本地 SQLite(重开不重解析);长书 `page_ranges` 分批 + 进度回传前端。
- [x] 从 MinerU `middle.json` 切块:按 Level2 块/Line 粒度,**每块带 `page_idx` + 换算后的归一化 bbox**;章节归属。
- [x] Embedding 只走外部 provider:`EMBEDDING_PROVIDER/API_KEY/BASE_URL/MODEL`,DB 存 provider/model+维度,切换即重嵌
- [x] 索引:FTS5(BM25)+ provider 向量混合检索函数;未配置 embedding 时必须可退化为纯文本检索
- [x] 索引版本号(每版书),解析引擎/参数随锚点存

**出口标准**:对一本书一键解析+建索引(MinerU 论文 / 本地名著两条路都通),`search_book("某概念")` 返回带坐标的相关块,框选能映射到块。

---

## Phase 3 · agentic 解读循环(2–3 周,核心卖点)

**目标:框选 → AI 规划 → 全书检索 → 带引用的深度解读。Codex 写循环逻辑,Opus 写卡片 UI。**

- [x] **多 provider LLM 抽象层**(见 `docs/[todo]20260531_llm-provider.md`):`LlmProvider` trait + `OpenAiCompatProvider`(DeepSeek 默认 + OpenAI 共用)+ `AnthropicProvider`;按 `LLM_PROVIDER` 实例化
- [x] 工具定义:`search_book` / `get_chunk` / `get_neighbors` / `list_structure`
- [x] agentic 循环(`_internal/[finish]20260531_PLANNING.md` §5):Plan → Retrieve → Iterate(封顶 2–4 轮)→ Synthesize。2026-07 起循环主体跑在 Codex 引擎(`codex exec` 子进程 + 本地 /mcp book 工具),失败回退 Rust 进程内管线
- [x] 系统提示钉死逐字选中段落 + 位置
- [x] **统一 chunk_id 引用**:证据带 `[chunk_id]` → 模型标注 → 后处理成可点击引用 → 跳回高亮
- [x] Prompt caching:静态前缀(DeepSeek/OpenAI 自动,Anthropic 显式三断点);命中率可观测仍缺(见缺口)
- [x] 设置 UI:provider 选择 + key 输入 + 连通测试
- [x] 解读卡片 UI:停靠选区旁、流式输出、引用点击跳转高亮(见 `[finish]20260531_UI-UX.md`)
- [x] 解读持久化 + 历史

**出口标准**:框选名著一段,得到带 3+ 条可点击引用的解读,引用能跳回书中确切位置;成本可观测(cache 命中率)。

---

## Phase 4 · 打磨与发布(1–2 周)

- [x] 错误态/空态/加载态全覆盖(Storybook 走查,见 `docs/ui/[todo]20260608_UI改造清单.md` 核销记录)
- [ ] 性能:大 PDF(>500 页)流畅度、索引耗时、内存
- [x] 可访问性 + 字体/字号偏好(reduced-motion 全局兜底 + 阅读外观「Aa」控制)
- [ ] 设备矩阵测试(多 macOS 版本)
- [ ] 打包签名分发(macOS 优先,Windows 次之):debug `.app` 由 `pnpm health:bundle` 生成;~~DMG 卡在 create-dmg~~ **已解决**——`scripts/release_dmg.sh` 可用,已发到 0.1.8;剩签名/公证
- [x] 渐进发布:先给自己和朋友用(0.1.8 已出 14 个本地 dmg)

**出口标准**:你自己能用它重读一本名著,且"如果有 AI 帮我解读会很不一样"的体验真实成立。

---

## V2 及以后(里程碑级,不排期)

- 复杂论文增强(marker/MinerU,公式表格)— 服务端 GPU 微服务
- 古诗词典故外部检索 `search_external`
- 云端 OCR 兜底(Mistral OCR)
- 重排版双视图
- **移动端**:Rust 核心经 FFI 复用 + React Native/Expo 薄壳(或 Tauri v2 移动端,先真机 spike)
- 短书"整本缓存单次解读"模式
- 跨页选区、结构化解读卡片

---

## 关键里程碑温度计

| 里程碑 | 验证的核心假设 |
|---|---|
| Phase 0 出口 | 技术栈在真机上全部可行(坐标/向量/解析/API) |
| Phase 1 出口 | **框选锚点耐久**(全产品最难点,最先验证) |
| Phase 3 出口 | **agentic 深度解读体验成立**(护城河) |
| Phase 4 出口 | **你自己愿意用它重读一本书**(PMF 的第一个信号) |
