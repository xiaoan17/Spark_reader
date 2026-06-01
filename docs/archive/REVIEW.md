# 框选精读 · 整体 Review 报告

> ⚠️ **归档快照(2026-06-01)**:这是某一时点的一次性评审记录,非常驻文档。其中部分缺口可能已修复、部分技术描述(如 PyMuPDF/sqlite-vec)已不反映当前实现。当前架构以 `README.md` 与 `docs/` 为准,保留此文件仅供追溯当时的判断与权衡。

> **目的**：从客观视角审视项目当前状态，识别架构设计、模型选型、工程实现、UI 落地与质量保障 5 个维度的风险、错位与改进空间。
> **范围**：已实现代码 + 完整规范文档（`PLANNING.md` / `HANDOFF.md` / `ROADMAP.md` / `UI-UX.md` / `AGENTS.md` / `docs/*`），截至 2026-06-01。
> **态度**：review，不是 audit。问题按"对未来的影响"分级，不挑刺、不重复 ROADMAP 里已知缺口。
> **基线**：HANDOFF.md 把项目定调为"已知可行、就差实现"，本文按这个基线走——不复述规划，复述实现 + 实现与规划之间的张力。

---

## 0. 总评（一句话先给你定调）

> **架构思路对，文档体系扎实，但实现层有几处"和规划不同步"的地方需要明确认知。**最值得动手的不是"补 Phase 4 发布打磨"，而是先把 **agentic 循环中的中文检索策略**、**chunk_id 命名空间**、**chunk_id 引用正则**这三处"看不见的逻辑债"清理掉——这些一旦上线变成模型输出就难调了。

---

## 1. 做得好的地方（先承认，再批评）

| # | 点 | 出处 |
|---|---|---|
| 1 | **文档化程度极高**：HANDOFF / PLANNING / ROADMAP / UI-UX / AGENTS + 5 个 docs 构成完整知识体系，规划阶段把"事实核查修正"明确写进文档（如"pdf.js 字符偏移量不耐久"），避免后续 agent 重复踩坑 | `HANDOFF.md §3.1`、`PLANNING.md §7 风险表` |
| 2 | **坐标系统规范 + 双向单测**：`docs/coordinate-spec.md` 钉死归一化页坐标（0..1，左上原点），Rust + TS 双实现 + 7 个 unit test + Rotate 90/180/270 + CropBox 真实样本 | `src-tauri/src/coordinates.rs:121-197`、`src/core/coordinates.ts:27-201` |
| 3 | **统一 chunk_id 引用**——不绑厂商 Citations，三家 provider 走同一套证据后处理（`enforce_grounded_citations`），是护城河 | `src-tauri/src/interpretation.rs:1012-1093` |
| 4 | **失败回退链路完整**：backend RAG → 本地兜底 (`local-interpreter.ts`) → 离线自检（`--product-self-check`），层层降级且都有"诚实标注" | `src/App.tsx:348-393`、`src-tauri/src/product_self_check.rs` |
| 5 | **agent-host 隔离设计**：端口隔离 + tools 白名单（只允许 `book_search/get_chunk/get_neighbors/structure`，shell/edit/web 全 deny） | `agent-host/src/index.ts:97-145`、`docs/opencode-agent.md` |
| 6 | **embedding 严防混用**：`embeddings.rs` 强制 `expected_dimension` 校验，dim 不一致直接 fail 而不是静默混用 | `src-tauri/src/embeddings.rs:171-178` |
| 7 | **健康检查脚本**：`pnpm health` / `pnpm health:bundle` 串行跑 fmt/测试/构建/密钥扫描/打包+产品自检 | `scripts/product_health_check.sh` |

---

## 2. 架构层 Review

### 2.1 ⚠️ 双套 LLM 链路并存，agent-host 当前是"准备好了但没接入"

**观察**：
- `src-tauri/src/llm.rs`（Rust 直接调 DeepSeek/OpenAI/Anthropic，**实际被 production 路径用**）
- `agent-host/`（OpenCode wrapper + 自定义 tool，4 个 `book_*` 工具，**规划层写得很重但没接入主路径**）

**问题**：
- `interpretation.rs:560-680` 的 `run_model_tool_loop` 跑的是 Rust 自己的 `llm::chat_with_tools`，没走 agent-host
- agent-host 的 `book_search` 等 tool 是在另一台 OpenCode 进程里通过 HTTP 调 Rust 端，需要 Rust 暴露另一套 HTTP API（"book tool" service）—— 链路多一跳
- `PLANNING.md §5` 写"agentic RAG 循环"，`docs/llm-provider.md` 写"多 provider"，`docs/opencode-agent.md` 又写"OpenCode runner"——三处口径不一致，未来谁来主导谁没明文

**建议**：
- **明文决策**：agent-host 是要"废"，还是要"切"？
  - 如果是"废"：把 `agent-host/` 目录从主工作区移走（或归档到 `experiments/`），避免后续 agent 误以为这是主路径
  - 如果是"切"：把 `interpretation.rs` 的工具循环迁过去，并把 `book_*` 工具真正接通 Rust 侧
- 现在的"半成品"状态最危险：新人会以为 `agent-host/opencode.json` 是产品级配置
- 决策建议：**短期"废"**——Rust 直连已经够用，OpenCode 增加了一层 agent 框架/SDK 依赖和一个 HTTP 旁路，对护城河（深度解读）没有可见增益

### 2.2 ⚠️ `storage.rs` 单文件 132KB / 3712 行——职责严重堆积

**观察**：
- `src-tauri/src/storage.rs:1-3712` 一文件承担：
  - SQLite schema 初始化与连接管理
  - book / chunk / highlight / interpretation / search_index / embedding_cache CRUD
  - FTS5 全文索引
  - 向量相似度检索（应该是 sqlite-vec）
  - 本地资产文件系统操作（text/markdown/PDF 文件管理）
  - 解析结果缓存指纹
- 17 个公开 struct、50+ 公开函数、单一 `Connection` 在 fn 之间传递

**问题**：
- 未来加 schema 迁移（`ALTER TABLE`）会非常痛
- 任意一处改动都触发整文件增量编译
- 单测集中在 `mod tests`（文件底部），无法分 crate 隔离
- 与 `interpretation.rs`（2414 行）类似——但后者是"算法可分"，前者是"schema 强耦合"更难拆

**建议**：
- 至少按"对象"拆成多个子模块（`storage/books.rs`、`storage/chunks.rs`、`storage/search.rs`、`storage/assets.rs`），仍可保持单一 SQLite 连接通过 `Storage` 句柄分发
- 引入一个轻量 `Migration` trait，从 `connection.execute_batch("CREATE TABLE...")` 升级到有序迁移脚本（顺序记录到 `schema_version` 表）

### 2.3 ⚠️ Tauri ↔ TypeScript 类型漂移（三层重复定义）

**观察**：
- 同一个 `SavedInterpretation` shape：
  - `src-tauri/src/storage.rs:40-56`（Rust 端字段定义 + serde rename）
  - `src/core/library-api.ts:181-211`（TS invoke wrapper）
  - `src/stores/reader-store.ts:40-56`（Zustand store 类型）
- 改一处要同步改三处，且没有任何工具校验
- 同样问题：`TextQuality` / `SearchIndexSummary` / `StoredBookSummary` / `MiningProgressEvent` 等至少 8 个类型

**问题**：
- 加新字段时漏改一边，runtime 才报错（甚至不会报错，可能静默）
- rename 策略不一致（`#[serde(rename = "bookId")]` vs `camelCase` 自动 rename），新人维护成本高

**建议**：
- 短期：把 Rust 端的 `#[derive(Serialize)]` shape 当真相源，在 `commands.rs` 提供 `pub fn get_type_definitions() -> serde_json::Value` 暴露给前端，前端 `tsc --check` 校验
- 长期：考虑用 `ts-rs` 或 `specta` 自动生成 TS 类型
- 即使短期做不到，也要在 `AGENTS.md` 加一条铁律："任何 Rust↔TS 共享 struct，TS 类型必须从 `library-api.ts` 导出，store 只能 re-import"

### 2.4 ⚠️ 缺乏 schema migration 机制

**观察**：
- `src-tauri/src/storage.rs` 的 `init_db`（推测在文件中间）会 `CREATE TABLE IF NOT EXISTS`，但没有 `schema_version` 表
- 一旦生产数据写入，schema 改动只能 forward-compatible（加 nullable 列）；破坏性变更需要写一次性 `migrate_from_v1_to_v2` 函数
- 用户的"长书分批"、高亮 + 解读历史都已经落库——是真数据

**建议**：
- 即刻加 `user_version` pragma + 启动时按版本号跑有序迁移
- 至少写一个 `migrate_v1_to_v2` 模板（即使 v1 还没破坏性变更），建立迁移心智模型

### 2.5 🔍 Tauri 命令表面过大（46 个 command）

**观察**：`src-tauri/src/lib.rs:21-60` 注册了 46 个 `#[command]`，跨越 LLM 测试、embedding 测试、MinerU 设置、本地解析、PDF 读、书库、解读、引用、章节、搜索……

**问题**：
- 单文件 845 行的 `commands.rs` 已经是 god-module
- 没有按业务域拆分（settings / parsing / interpretation / library）

**建议**：拆 `commands/` 为多个文件（`commands/settings.rs`、`commands/parsing.rs`、`commands/interpretation.rs`），统一在 `lib.rs` `invoke_handler!` 集中注册。这是个低风险、立即可做的小重构。

### 2.6 ✅ 坐标 / 锚点规范是产品级铁律

**优点**（值得肯定）：
- `ScaledPosition` 几何 + `TextQuoteSelector` 语义桥 + `TextPositionSelector` 仅提示——三层结构清晰
- `enforce_grounded_citations` 后处理用 `rewrite_chunk_citations` 严格只留 allowed chunk_ids
- 实测验证 `middle.json` 原点为左上角（`docs/mineru-integration.md §4`），并写进了测试

**小问题**：
- `src/components/reader/text-selection-anchor.ts:65-107` 的 `normalizedOffsetForRawOffset` / `rawOffsetForNormalizedOffset` 是 **O(n) 全文本扫描**——对 500+ 页长书，每次选区都重扫整页文本，性能会肉眼可感地卡
  - 建议：建一次 `charIndex → normalizedOffset` 数组的 O(n) 预处理，后续 O(log n) 二分；或者直接用 WASM 字符串库
- `highlight-restore.ts` / `interpretation-history.ts` / `selection-chunks.ts` 等 7 个 `*.ts` 文件各自维护"重锚"逻辑——重复 code 较多，可以归并成 `core/anchor-restore.ts`

---

## 3. 模型层 Review（重点）

> 这是最值得你停下来细读的一节——模型层一旦上线，所有"看不清"的逻辑债都会变成用户能感知的输出质量。

### 3.1 🔴 引用正则过宽，会把"page 5"、"Table 3"误判为合法 chunk_id

**位置**：
- `src-tauri/src/interpretation.rs:1086-1093` 的 `is_chunk_id_like`：
  ```rust
  fn is_chunk_id_like(value: &str) -> bool {
      !value.is_empty()
          && value.chars().count() <= 80
          && value.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
          && value.chars().any(|ch| ch.is_ascii_digit())
  }
  ```
- 前端 `src/components/interpretation/InterpretationCard.tsx:455-460` 同款正则：
  ```js
  /^(?=[a-z0-9_-]{1,80}$)(?=[a-z0-9_-]*\d)[a-z0-9_-]+$/i
  ```

**问题**：
- LLM 输出 `看 page 5 的定义` → `[page 5]` 被识别为合法 chunk_id，加进 `enforce_grounded_citations` 的 allowed 集合过滤后又被滤掉——这一步没问题
- 但当 LLM 真正 hallucinate 一个"听起来像 ID"的字符（如 `[chap03_pg5]`）——只要里面有数字+字母就合法，会被前端 `renderCitations` 渲染成可点击按钮，点了跳不到任何东西
- 更严重：正则要求"必须含数字"，会把不含数字的真 chunk_id 误判为非法

**建议**：
- 把 chunk_id 格式固化为带书/章节前缀的强约束（如 `{bookShortId}-p{pageIndex}-c{chunkIndex}-{hash}`），正则收紧到匹配该格式
- 或者 chunk_id 始终 UUID-like（`xxxx-xxxx-xxxx`），正则只匹配这种
- 同时让前后端正则共用一份 fixture 测试

### 3.2 🔴 chunk_id 命名空间缺失——跨书 / 跨版本可能冲突

**观察**：
- 当前的 chunk_id 长这样：`p1-c1`、`p10-c4`（见 `src/core/selection-chunks.ts`、`src/core/local-interpreter.ts`）
- 没有任何 book_id / version 前缀

**问题**：
- 同一 chunk_id 跨书搜索时会混淆
- DB 重建后 ID 可能重号，旧 highlight / interpretation 引用错位
- `text-quote-selector.ts` 存了 `positionStart/End` 作为"hint"，但 chunk_id 才是真相——一旦解析器升级、新书用了相同 pX-cY 编号，错引

**建议**：
- chunk_id 应至少是 `{bookIdShort}-{pageIndex}-{chunkIndex}-{contentHashShort}`，contentHash 用 SHA-256 前 6-8 字符，保证：
  1. 跨书绝不冲突
  2. 同内容 hash 稳定（重新解析同一本书不会变 ID）
  3. 视觉可读（仍带 page/chunk 位置）
- 这是改 schema 的事，但越早改越省事

### 3.3 🔴 中文检索策略较弱——`semantic_terms` 的 N-gram 在中文几乎无效

**位置**：`src-tauri/src/interpretation.rs:946-1010`

**观察**：
```rust
fn semantic_terms(text: &str) -> Vec<String> {
    // 按非 alphanumeric 字符切，再加 2-gram / 3-gram
    let mut terms = compact.split(|ch: char| !ch.is_alphanumeric())...
    for window in chars.windows(2).take(80) { terms.push(...) }
    for window in chars.windows(3).take(80) { terms.push(...) }
}
```

**问题**：
- 对英文："compound interest rate" → 切出 `["compound", "interest", "rate", "co", "om", ...]`，BM25 召回还行
- 对中文："复利来自长期坚持" → `\W` 切分对中文是 0 字符（中文都是 alphanumeric 范围），整句变成一个"词"；2-gram 切出 `["复合", "利来", "自长", ...]` 也不是语义单位
- 中文是**无空格分词**语言，需要 jieba / hanlp 之类分词器

**建议**：
- 短期：在 `focus_phrase_queries`（`interpretation.rs:812-841`）之外，叠加中文分词（N-gram 按 1-2 字做 term expansion）作为 BM25 term
- 长期：考虑用 hanlp-rs 或 jieba-rs 做轻量分词（pre-1.0 锁版本）
- 顺带：`focus_phrase_queries` 用了"`，。；：！？`"等做切分，对古文 / 繁体 / 竖排 PDF 不准

### 3.4 🔴 没有 query rewrite / HyDE / 召回策略

**观察**：
- `build_retrieval_plan` 直接把 selection_text 当第一个 query（`interpretation.rs:779`），然后"加 '定义 背景 上下文' 模板"（`interpretation.rs:852-855`）
- 没有 LLM 改写 query（"什么是 X" → "X 的定义"）
- 没有 HyDE（让 LLM 先生成"假设答案"，用假设答案的 chunk 做 embedding 召回）

**问题**：
- 用户框选"他望着窗外的雨"这种文学性表达，selection_text 直接搜基本召回 0
- 跨语言场景（中英对照书）会回 0

**建议**：
- 增加一个 `search_query_rewrite` LLM 步骤：让 LLM 基于焦点段落生成 3-5 个检索 query（关键词组合、释义、抽象概念）
- 放在 `build_tool_loop_messages` 第一轮，让 LLM 主动产出 query，而不是规则模板
- 这正是 `run_model_tool_loop` 已经在做的——但缺一个明确的"先生成 query 再搜"环节，当前 round 0 模型可能直接调 `get_chunk` 跳过了 search

### 3.5 🟡 `trim_for_prompt` 是 char-level 硬截断，可能切断关键证据

**位置**：`src-tauri/src/interpretation.rs:1443-1464`（推测）

**问题**：
- `trim_for_prompt(&hit.text, 260)` / `trim_for_prompt(&hit.text, 900)` 都按 `chars().take(max_chars)` 截断
- 中文每个字 1 个 char，900 字 ≈ 900 中文字——但 LLM 的 token 视角是 1.5-2 token/字，900 中文字 ≈ 1500-1800 token
- 在按句号、问号、段落边界截断上没做"安全网"
- 更糟：`semantic_terms` 也是 2-gram/3-gram 滑动窗口，对截断后片段做检索，可能匹配无关

**建议**：
- 截断策略改为"按句子边界优先 + char 上限兜底"
- 对中文单独处理：用 `。！？` 优先切
- 把截断后的剩余字符数也传给 LLM（"以下片段共 900 字"），让 LLM 知道这是截断

### 3.6 🟡 `fallback_grounded_answer` 的"模板解读"会被用户误判为真 LLM 输出

**位置**：`src-tauri/src/interpretation.rs:1095-1188`

**观察**：
- LLM 失败时返回的兜底答案长这样：
  ```
  以下是基于本地检索证据生成的可核对深度解读。
  框选文本：xxx
  上一轮解读要点：...
  书内证据：...
  可先把这段理解为：它在当前上下文中提出一个需要结合前后文判断的重点。
  最近的证据是第 5 页 [p5-c2]，它给出了同页或近邻语境...
  可核对证据：[p5-c2] 第 5 页 [p3-c1] 第 3 页 ...
  ```
- 格式非常"像 LLM 输出"，但其实是 Rust 模板字符串拼接

**问题**：
- 用户看不出这是"机械兜底"
- 误导性高：用户以为 AI 真的"理解了"它
- 一致性问题：兜底答案在 `src/core/local-interpreter.ts` 的 `makeLocalInterpretation`（前端 fallback）和 Rust 兜底是**两套完全不同的格式**——同一个用户路径可能看到不同样子的兜底

**建议**：
- 兜底答案必须在 UI 上明确标注"⚠️ LLM 暂不可用，本地模板生成"
- 两端（前端 + Rust）的兜底文案应该统一来源（建议从 Rust 端 API 暴露，前端只展示）
- 思考：要不要直接**禁用**非 LLM 的"解读"——只显示"已找到 N 条书内证据，请人工查看"？产品上更诚实

### 3.7 🟡 没有 eval suite——无法衡量 RAG 迭代效果

**观察**：
- 测试套件有 110 个 vitest + 87 个 Rust 测试，但都是单元/集成测试
- 没有"问题 → 期望 chunk_id" 的评测集
- 没有 recall@k / 引用准确率指标

**问题**：
- 改 BM25 权重、改 query 模板、改 N-gram 窗口时，不知道召回/精度是涨是跌
- 引用后处理（`enforce_grounded_citations`）的"valid_count" 是埋点但没有暴露到 metrics
- 模型层迭代完全靠肉眼"试 3 本书"

**建议**：
- 建一个 `eval/` 目录：包含 30-50 条"问题 + 期望 top-3 chunk_id + 期望引用数"的 JSON fixture
- 跑一次 `cargo run -- --eval`，输出 recall@1/3/5 + 引用准确率
- 接入 `pnpm health` 作为一项指标，长期跟踪
- 这件事不复杂但"不开始就永远不会有"

### 3.8 🔍 `LLM` 默认模型名 `deepseek-v4-flash` 实际不存在

**观察**：
- `docs/llm-provider.md:31` 写：`deepseek-v4-flash`（规划/工具）
- `agent-host/src/index.ts:42` 写：`deepseek-v4-flash`
- `.env.example:57` 写：`DEEPSEEK_MODEL=deepseek-v4-flash`

**问题**：
- 截至 2026-06-01，DeepSeek 公开模型线是 `deepseek-chat` / `deepseek-reasoner` / `deepseek-coder` 等
- "deepseek-v4-flash" 不存在于 DeepSeek 公开模型列表——这个模型名是不是内部代号 / 误写 / 想象的？

**建议**：
- 立刻核实这个模型名
- 如果是误写，README / .env.example / agent-host / 文档全部要改
- 如果是内部代号/未来模型，要在 docs 里加注释："此为占位模型名，待 DeepSeek 发布后切换"

### 3.9 🔍 prompt caching 策略未落地

**位置**：
- `src-tauri/src/llm.rs:628-651`（OpenAI body）—— 没有显式 `cache_control`，但 OpenAI / DeepSeek 走的是"自动 prompt caching"
- `src-tauri/src/llm.rs:701-720`（Anthropic body）—— **没有 `cache_control: ephemeral` 断点**

**问题**：
- `AGENTS.md §2.4` 铁律："绝不缓存整本书、绝不缓存 tool_results"
- 但 **Anthropic 适配器完全没设置 `cache_control`**——系统提示 + 工具定义每次都全量传输
- `docs/llm-provider.md §6` 说"Anthropic 显式三断点缓存静态前缀"——但代码没实现

**建议**：
- Anthropic body 加三断点缓存（system / 工具定义 / 第一条 user 消息前缀）
- 增加 cache 命中率埋点：把 `usage.cache_creation_input_tokens` / `usage.cache_read_input_tokens` 暴露到 metrics
- 短期不做的成本：Anthropic 比 OpenAI compat 贵 5-10 倍，缓存能省 80%+

### 3.10 ✅ 模型层做得好的（具体可保留）

- **统一 chunk_id 引用 + 后处理**：不依赖厂商 Citations，是真的护城河
- **每轮重钉焦点**：`build_messages` 和 `build_tool_loop_messages` 每轮都把"框选文本"塞进 user prompt，配合 system 提示的"不要泛化总结"——防漂移做得到位
- **agentic 收敛**：`MAX_TOOL_ROUNDS=3, MAX_TOOL_CALLS_PER_ROUND=4`，封顶 12 次工具调用——避免失控
- **enforce_grounded_citations 双重保险**：先把无效 ID 删掉，没有有效 ID 时追加脚注——总比 hallucinate 强
- **`ACTIVE_INTERPRETATIONS` + `CancellationToken` 取消链路**：`interpretation.rs:16-335` 的全局 map + Arc<AtomicBool> 取消，前端 `cancelInterpretation` 可用——这个取消链路非常扎实

---

## 4. 工程实现层 Review

### 4.1 🔴 `App.tsx` 是上帝组件（848 行）

**位置**：`src/App.tsx`

**问题**：
- 同时管：
  - 计时器管理（`useRef<number[]>` + `schedule/clearTimers`）
  - 流监听器（`streamUnlisten` + `attachInterpretationStream`）
  - request guard（`requestGuard.current` + version 计数）
  - 业务编排（`runBackendInterpretation` / `runFallbackInterpretation` / `answerFollowUp` / `persistInterpretation` / `handleSaveHighlight` / `handleCitationClick` / `handleOpenHighlight` ...）
  - 十几个 store setter 透传

**建议**：抽 hooks：
- `useInterpretationStream(requestId, version, question?, followUpId?)` —— 封装 listener + 状态机
- `usePersistInterpretation()` —— 封装保存逻辑
- `useHighlightActions()` —— 封装保存/删除/打开
- `useRequestGuard()` —— 封装 version 计数 + isCurrentRequest
- `useTimerQueue()` —— 封装 setTimeout 队列
- App.tsx 缩到 ~250 行，只剩"业务编排"主体

### 4.2 🟡 store 直接被 setState 绕开

**位置**：`src/App.tsx:225-227, 252-294`

**观察**：
```ts
useReaderStore.setState((state) => ({
  interpretation: `${state.interpretation}${event.delta ?? ""}`,
}))
```

**问题**：
- 绕开了 store 提供的 API（`appendStreamingDelta` / `setInterpretation`）
- store 失去"单写入口"，未来要加 trace / 重放 / 持久化时会很痛
- `reader-store.ts:161-359` 已经有 13 个 setter，但 App.tsx 还是直接 setState

**建议**：
- store 加 `appendStreamingDelta(delta: string, scope: "interpretation" | "followUp", followUpId?: string)` 之类的 action
- 严禁 `useReaderStore.setState` 在 App.tsx 出现，移到自定义 hook 内

### 4.3 🟡 ReaderShell 85KB / 2388 行——必须拆分

**位置**：`src/components/reader/ReaderShell.tsx`

**观察**：
- 一文件包含：菜单栏 / 侧栏 / 主区 / 进度条 / 设置面板 / 高亮列表 / 解读历史 / 搜索结果 / 启动恢复 / 文本选择 anchor
- 80+ props 透传
- 没有 useMemo / useCallback —— 每次 state 变化全树重渲染

**问题**：
- 改一处要全文件读一遍
- 任何新 agent 接手都要花 1 小时理解数据流
- 无法做移动端拆分（PLANNING §8 提到移动端用 RN/Expo 薄壳，UI 复用核心）

**建议**：按职责拆：
- `ReaderShell`（布局 + 顶/侧/底栏结构）
- `ReaderMenuBar`（顶栏）
- `ReaderSidePanel`（侧栏，包含目录/搜索/高亮/解读历史 4 个 tab）
- `ReaderCanvas`（主区，纯展示 PDF + 高亮）
- `ReaderSearchPanel`（搜索结果）
- `ReaderHighlightsPanel`（高亮管理）
- `ReaderHistoryPanel`（解读历史）
- props 用 zustand selectors 派生，而不是大对象透传
- 用 `React.memo` 隔离主区与侧栏的渲染

### 4.4 🟡 `text-selection-anchor.ts` 全文 O(n) 扫描

**位置**：`src/components/reader/text-selection-anchor.ts:65-107`

**观察**：
- `normalizedOffsetForRawOffset` / `rawOffsetForNormalizedOffset` 每次选区都从头扫整页文本
- 对 500+ 页长书的某一页（可能有 1-2k 字符）还好，但配合 `selectedTextOccurrenceOrdinal` 多遍扫描，单次选区可能 O(3N)

**问题**：
- 长书拖选时会卡
- React 重渲染 + 扫描叠加，主线程阻塞

**建议**：
- 缓存"raw offset → normalized offset" 数组（每页一次预处理）
- 或者改成 `Intl.Segmenter` 按 word boundary 切，O(log n) 二分

### 4.5 🟡 `handlePointerUp` + `setTimeout(0)` 经典反模式

**位置**：`src/components/reader/PdfCanvasPage.tsx:139-180`

**观察**：
```ts
function handlePointerUp() {
  window.setTimeout(() => {
    const selection = window.getSelection()
    // ...
  }, 0)
}
```

**问题**：
- 经典 hack：在 click 之后读 selection，否则 selection 已被清空
- 在 Safari / Firefox / 触屏环境下不可靠
- 触屏 / Apple Pencil 选区会丢

**建议**：
- 改用 `pointerup` + `selectionchange` 事件 + 防抖
- 或直接监听 `document.selectionchange`
- 这是个 0.5 天的工作量但体验会立刻好

### 4.6 🟡 `TextLayer` 没绑 React 生命周期

**位置**：`src/components/reader/PdfCanvasPage.tsx:67-137`

**观察**：
```ts
useEffect(() => {
  // ... new TextLayer(...)
  textLayer = new TextLayer({...})
  await textLayer.render()
  return () => { cancelled = true; renderTask?.cancel(); textLayer?.cancel() }
}, [pageNumber, pdf, zoom])
```

**问题**：
- React 19 strict mode 会双 effect：第一个 effect cancel 之前第二个 effect 已启动 → 双重 TextLayer 渲染
- 切换页面时 `textLayerContainer.replaceChildren()` 清理，但 `TextLayer` 实例自身没有 dispose
- 错误处理：异常路径没 await cancel，内存泄漏风险

**建议**：
- 用 `useRef<TextLayer | null>` + 显式 `dispose()`
- 加 `AbortController` 把 pdf.js 异步操作串联
- 跑一遍 React strict mode dev，看是否有双渲染日志

### 4.7 🟡 local_parser sidecar 是 Python 脚本路径

**位置**：`src-tauri/src/local_parser.rs:30KB`、`scripts/extract_pdf_text.py`、`scripts/setup_local_parser.sh`

**问题**：
- Python 解释器 + PyMuPDF 依赖需要在 .app 里分发
- setup_local_parser.sh 是手动跑，不是 postinstall
- README 提"`pnpm setup:local-parser`" 是可选，但 storage 测试和生产路径可能隐式依赖
- 实际分发：.app 里只放 .py 脚本，PyMuPDF 用系统 Python 还是打包 venv？文档没说清

**建议**：
- 把 PyMuPDF 切换到 Rust 端的 `pdfium-render` 或 `mupdf`（cargo crate）—— 完全消除 Python 依赖
- 或者在 .app Resources 里放 venv，打包脚本保证 `Contents/Resources/.venv` 存在
- 短期：建一个 `pnpm postinstall` 自动检查 venv 状态 + 提示用户

### 4.8 🟡 `embeddings.rs` 用了 blocking client

**位置**：`src-tauri/src/embeddings.rs:189-205`

**观察**：
```rust
fn embedding_client() -> Result<Client, EmbeddingError> {
    Client::builder()
        .connect_timeout(...)
        .timeout(...)
        .build()
}
```

**问题**：
- `reqwest::blocking::Client` 在 Tauri 异步命令里会阻塞 tokio runtime worker
- 大量 embedding 调用（500+ 页 → 1 万+ chunk）会拖垮整个应用响应

**建议**：
- 改用 `reqwest::Client`（async） + `tokio::task::spawn_blocking` 隔离，或者用 `tokio::time::timeout` 包裹
- 同步语义不变（接口签名不动），内部换实现

### 4.9 🟡 `embeddings_url` 隐式 URL 拼接无测试

**位置**：`src-tauri/src/embeddings.rs:215-222`

**观察**：
```rust
fn embeddings_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/embeddings") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/embeddings")
    }
}
```

**问题**：
- 用户写 `https://api.siliconflow.cn/v1` → 期望拼接 → 实际拼接 ✓
- 用户写 `https://api.siliconflow.cn/v1/embeddings` → 期望不拼接 → 实际不拼接 ✓
- 但这个行为没有 unit test 覆盖
- 边角 case：用户写 `https://api.siliconflow.cn/v1/`（末尾斜杠）→ trim 后是 `https://api.siliconflow.cn/v1` → 拼成 `https://api.siliconflow.cn/v1/embeddings` ✓
- 边角 case：用户写 `https://api.siliconflow.cn/v1/embeddings/`（末尾斜杠 + 路径已有 /embeddings）→ trim 后是 `https://api.siliconflow.cn/v1/embeddings` → 不拼接 ✓

**建议**：补一个 unit test 覆盖 4 种 case。

### 4.10 🔍 其他工程实现细节

- `commands.rs:100-150` 中 `parse_pdf_text` 和 `import_pdf_text` 重名（`parse_pdf_text` 返回 raw parsed doc，`import_pdf_text` 走完整流程）—— 命名混淆
- `app.tsx:541-543` 选了 `pageIndexes[0] ?? currentPage - 1` 作为 pageIndex，但 pageIndex 应该是 box 含义（0-based），currentPage 是显示（1-based）—— 注意减一，否则会少 1 页
- `App.tsx:230-238` 的 `setPhase("streaming")` 在 done 事件里设了，但 done 之前还有 "synthesizing" 阶段，最终 phase 是 streaming 而不是 reading——读 store 时可能困惑
- `App.tsx:296-309` `handleQuestionSubmit` 单独发，但 `runBackendInterpretation` 在 `runLocalInterpretation` 流程里——两条路径状态机会分叉
- `local_parser.rs:30KB` 单文件，职责跟 storage.rs 类似问题

---

## 5. UI / UX 层 Review

### 5.1 🟡 `isMobile()` 反模式在 PLANNING 中说要消灭，但实现里没真正分离

**观察**：
- `UI-UX.md §7`："消灭 `isMobile()` 散布"
- `PLANNING.md §8`："把核心展示组件做成端无关纯组件"

**问题**：
- `ReaderShell.tsx` 85KB 单文件，所有 layout 逻辑都在里面
- `InterpretationCard.tsx` 是纯展示组件——做得好
- 但 PDF 渲染、菜单、侧栏逻辑全混在 ReaderShell，没法"未来 RN 薄壳复用"

**建议**：
- 即使短期不上移动端，也先做这一步：
  - `ReaderCanvas`（只渲染 PDF，props: `pdfDoc, pageNumber, zoom, onSelection`）
  - `InterpretationCard`（已经纯展示）
  - 业务状态 hook（`useInterpretation`）放到 core
- 这样未来 RN 薄壳能复用 InterpretationCard + hooks，UI 壳自己实现

### 5.2 🟡 Storybook 覆盖度有缺口

**观察**：
- 16 个组件 vs 7 个 story 文件
- 没有：`Sidebar`、`Sheet`、`ScrollArea`、`HoverCard`、`Collapsible`、`Accordion`、`Dialog`、`Sheet`、`Tooltip` 等
- 这些是 shadcn 组件，如果用了没 story 就有"被改坏"风险

**问题**：
- AGENTS.md 铁律：每个新组件必须枚举全状态
- 但设置页 (`LlmSettingsPanel.tsx` 25KB) 有 story，Button 这种基础组件反而没 story？

**建议**：补 storybook stories 至少覆盖 `Sheet` / `Sidebar` / `Dialog` / `Accordion` / `Collapsible` / `HoverCard`（用 mock 数据）。

### 5.3 🟡 解读卡片没有"loading 中断点"反馈

**位置**：`src/components/interpretation/InterpretationCard.tsx:182-205`

**观察**：
- `phase === "planning"`：3 行 Skeleton
- `phase === "retrieving"`：显示 "正在书中查找相关证据" + Badge 列表
- `phase === "streaming"`：流式输出文本

**问题**：
- 检索阶段（2-3 秒）只显示 1 行文字"正在查找"，信息密度低
- 引用点击的 loading 没体现
- 网络慢时用户会以为卡死

**建议**：
- retrieving 阶段展示 `agentTrace` 的 1-2 步（"已读取框选页" → "已检索 3 条相关 chunk"）
- 加预估时间（基于本地历史的 P50/P95）
- 失败重试用 `Alert + [重试]` 按钮替代纯文字

### 5.4 🔍 UI 层做得好的

- 解读卡片有完整的 5 个状态枚举（planning / retrieving / streaming / reading / error）
- shadcn 组件名贯穿（无 iOS 风文字 + 自创组件）
- 设计语言统一（纸感、墨黑、克制强调色）
- 设置页有完整测试和 story

---

## 6. 测试 / 质量层 Review

### 6.1 🟡 真实窗口 E2E 仍是缺口

**观察**：
- `pnpm test` = vitest（110 个测试）—— 全是单元/组件测试
- `pnpm health:bundle` = 编译 + 打包 + 跑产品自检 CLI —— **但产品自检不消耗 LLM/embedding，不测真实解读**
- `ReaderShell.test.tsx`（31KB）—— 组件集成测试，但没有真窗口

**问题**：
- "导入 PDF → 框选 → 解读 → 引用跳转 → 持久化" 的端到端路径没有自动化覆盖
- 每次发布都靠手测
- 跨平台（macOS 版本、显卡、WebView）没有真实覆盖

**建议**：
- 短期：用 `tauri-driver`（WebDriver for Tauri）跑核心 5 步
- 长期：Playwright + 真实 Tauri binary，CI 跑
- 即使只覆盖 happy path，也是发布前最后一道关

### 6.2 🟡 没有 schema 一致性测试

**观察**：
- storage.rs 的 schema 改动会破坏已有数据
- 没有 migration 路径（见 2.4）
- 没有"创建 + 写入 + 重建 + 读回" 的 round-trip 测试

**建议**：
- 加一个 `storage_round_trip.rs` 测试：建库 → 写入 → 关闭 → 重新打开 → 读回 → 比较
- 模拟用户场景："导入同一本书两次，第二次应该命中缓存"

### 6.3 🟡 没有 fuzzing / 异常输入测试

**观察**：
- coord 测试覆盖了正常 case
- 但没有：
  - 空字符串选区
  - 单字符选区
  - 跨页选区
  - 全 whitespace 选区
  - LLM 输出里完全没有 `[chunk_id]` 的情况
  - LLM 输出全是非法 `[chunk_id]` 的情况

**建议**：对 `enforce_grounded_citations` / `text-quote-selector` 补 fuzz 测试。

### 6.4 ✅ 做得好的

- 健康检查脚本串联 fmt/test/build/scan，发布前关卡
- 密钥扫描（`scripts/secret_scan.sh`）避免误提交
- 110 + 87 个测试 + 自检 CLI 兜底

---

## 7. 安全 & 合规

### 7.1 🔴 早期规划对话中暴露过 token/key，需要轮换

**位置**：
- `docs/mineru-integration.md §7`、`HANDOFF.md §8` 已主动提醒
- `.env` 实际内容（建议 user 立即轮换）：`MINERU_API_TOKEN` / `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `EMBEDDING_API_KEY`

**建议**：
- 立刻去 mineru.net/apiManage 轮换 MinerU token
- 去 DeepSeek / OpenAI / Anthropic / SiliconFlow 控制台轮换各 key
- 之前 .env 内容如果出现在任何 git commit / 文档截图 / 聊天记录里，都要轮换

### 7.2 🔴 agent-host 缺生产级鉴权

**位置**：`docs/opencode-agent.md` / `agent-host/src/index.ts:50-51`

**观察**：
- `FOCUSED_READING_BOOK_TOOL_TOKEN` 默认是空字符串
- `index.ts:237-241` 只会 `console.warn` 提示

**问题**：
- 部署时如果忘了设 token，book tools 接口对外开放——同一台机器任何进程都能调
- 端口 48172/48174 是 127.0.0.1 bind 的，本机攻击面有限，但不是 0

**建议**：
- 强制 token 非空，否则启动失败
- 定期轮换 token

### 7.3 🔍 数据隐私

- 用户 PDF 内容会发往 MinerU 云端（如果是云端解析路径）
- 用户框选文本会发往 LLM 云端（DeepSeek/OpenAI/Anthropic）
- embedding 调用发往外部 provider（默认 SiliconFlow）
- 这些都写在 PLANNING §6 / HANDOFF §1 里，是已知妥协
- 建议在 UI 第一次启动时**明确告知用户**并要求确认（"您的 PDF 会被发送至 MinerU 进行解析……"）

---

## 8. 优先级建议（如果只能动 5 件事）

按"影响大、改动小、不可逆程度低"排序：

| 优先级 | 事项 | 估时 | 影响 |
|---|---|---|---|
| **P0** | **轮换所有 API key**（§7.1） | 30 min | 阻断安全事故 |
| **P0** | **chunk_id 格式固定为带命名空间 ID + 收紧正则**（§3.1, §3.2） | 1-2 天 | 阻断 hallucination 误引用 |
| **P0** | **轮换密钥 + secret_scan 加进 CI**（§7.1） | 1 小时 | 阻断未来泄漏 |
| **P1** | **中文检索 query rewrite**（§3.3, §3.4） | 3-5 天 | 显著提升 RAG 召回 |
| **P1** | **Anthropic cache_control 三断点**（§3.9） | 1 天 | 显著降本 |
| **P1** | **App.tsx / ReaderShell 拆分**（§4.1, §4.3） | 5-7 天 | 长期可维护性 |
| **P2** | **eval suite 建设**（§3.7） | 3-5 天 | 模型迭代可衡量 |
| **P2** | **schema migration 机制**（§2.4） | 2 天 | 未来升级不爆 |
| **P2** | **storage.rs 拆模块**（§2.2） | 3-5 天 | 单文件 132KB 不健康 |
| **P3** | **Tauri↔TS 类型生成**（§2.3） | 1-2 天 | 类型安全 |
| **P3** | **text-selection-anchor O(n)→O(log n)**（§4.4） | 1 天 | 长书流畅度 |
| **P3** | **fallback 兜底答案明确标注**（§3.6） | 半天 | 诚实可信 |
| **P3** | **真实窗口 E2E**（§6.1） | 1 周 | 发布前关卡 |
| **P4** | **embedding client 换 async**（§4.8） | 1 天 | 性能 |
| **P4** | **PyMuPDF → pdfium-render 切换**（§4.7） | 1-2 周 | 消除 Python 依赖 |
| **P4** | **agent-host 决策：废/切**（§2.1） | 1 天 + 后续 | 决定未来路径 |
| **P4** | **agent-host 强制 token 非空**（§7.2） | 1 小时 | 部署安全 |
| **P5** | **移动端骨架**（先做核心组件端无关化） | 持续 | 未来必需 |

---

## 9. 三句话总结

1. **架构层**：思路对、文档好，但有两件事必须立刻决断——agent-host 是废是切？chunk_id 命名空间是否要补？否则下游"看不见的债"会越滚越大。
2. **模型层**：基础（统一 chunk_id 引用 + 后处理）扎实，但中文检索策略、引用正则、引用命名空间这三处是"上线后才发现"的盲点——RAG 体验的 80% 决定在这里。
3. **工程层**：单文件过大（storage 132KB / interpretation 90KB / ReaderShell 85KB / App 848 行）已到需要拆分的临界点；不拆，新人上手成本和迭代速度会越来越差。

**最该被立刻阻止的两件事**：
1. `deepseek-v4-flash` 是不是真模型名（§3.8）
2. 真实 API key 是不是还在线上跑（§7.1）

**最该立刻动手的两件事**：
1. 把 chunk_id 改成带命名空间格式 + 收紧前后端正则（§3.1, §3.2）
2. 给 Anthropic 加 `cache_control` 三断点缓存（§3.9）—— 一天能搞定，但能省 80% Anthropic 调用成本

---

> 本文不替代 ROADMAP.md 的"还没做完"清单，聚焦**"做完了但可能做错"**的事情。Phase 4 的发布打磨照常推进，但 P0/P1 建议在发布前先动。
