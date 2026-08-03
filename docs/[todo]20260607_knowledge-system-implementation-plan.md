# 单书知识库完整开发任务与验收总控

> 日期：2026-06-07
> 最近对账：2026-06-07（对照真实代码核对，见 §0.5）
> 目的：把 `docs/archive/20260607_开发note_v1/` 中的多份方案收敛成后续开发的总控任务清单、阶段 check 目标和最终验收体系。
> 范围：shiji-kb 启发的「单书阅读知识层」完整实现，不替代现有 PDF 解析、坐标、RAG 主链路；它是在现有阅读器之上的持久知识沉淀层。

> ⚠️ **阅读须知**：本文件第 1、6、7、10 节是**蓝图与纪律**（仍然有效）；第 5 节的勾选框是**对账后的真实状态**，请以 §0.5 的状态快照为准。凡 §0.5 与下文细节冲突，以 §0.5 为权威。

---

## 0.5 实际状态快照（真相层 · 2026-06-07 对账）

> 本节是「计划意图」与「代码现实」的对账表。下文 P0–P9 是历史蓝图，部分勾选框曾长期失真；本节对照 `src-tauri/src/knowledge.rs`、`commands.rs`、`lib.rs`、`interpretation.rs`、`llm.rs` 和 `src/components/knowledge/` 逐条核实。

### 0.5.1 阶段真实完成度

| 阶段 | 蓝图意图 | 真实状态 | 证据 |
|---|---|---|---|
| P0 方案收敛 | 文档+铁律 | ✅ 已完成（git 纳入项除外，见 0.5.3） | `AGENTS.md:29` 铁律已落地；`README.md:92` 链接有效 |
| P1 体验增强 | 可信度/漂移/导出 v0/应用模式 | ✅ 基本完成 | `answer_source`/`groundedCitationCount`（`interpretation.rs`、`InterpretationCard.tsx`）、`list_drift`、`InterpretMode::Apply`、Markdown 导出 |
| P2 卡片地基 | 表+命令+面板 | ✅ 已完成 | `kb_cards/kb_evidence/kb_edges/kb_build_runs` 全部建表；CRUD 命令全部注册进 `lib.rs`；`KnowledgePanel.tsx` 等组件齐全 |
| P3 惰性补全/沉淀 | 惰性补全+健康度 | ⚠️ 部分完成 | 健康度 ✅（面板显示「已确认/候选/漂移」）；**惰性补全 `get_or_generate_*` 未实现** |
| P4 RAG 集成 | `search_knowledge` | ✅ 已完成 | `llm.rs:67`、`commands.rs:942`、`knowledge.rs:826`、已接入 `interpretation.rs` 主链路 |
| P5 实体/概念索引 | auto+LLM+反思+纠错 | ⚠️ 部分完成 | entity/concept card 类型已落库、`extract_event_sentences` 存在；反思轨/合并历史/纠错 UI 待补 |
| P6 事件时间线/地图 | 章节地图 | ✅ 已完成 | `get_book_knowledge_map`、`KnowledgeChapterMap.tsx`、`KnowledgeTimeline.tsx` |
| P7 关系/反链 | auto/LLM 边+反链 | ✅ 已完成 | `build_knowledge_graph`、`get_knowledge_graph`、`KnowledgeBacklinks.tsx`、`KnowledgeGraphView.tsx` |
| P8 导出/备份 | MD v1+JSON | ⚠️ 部分完成 | `export_book_knowledge_markdown` + `export_book_knowledge_json` 已实现；v1 完整字段与稳定文件名待核 |
| P9 产品自检/发布 | self-check+E2E | ⚠️ 待核 | `product_self_check.rs` 存在；知识层覆盖项与压测结果未回填 |

**关键纠偏**：P4/P6/P7 在本文下方曾标为大量 `[ ]` 未做，**实际已实现**；切勿据旧勾选框重做这些阶段。实际开发是**跳跃/并行**推进的，并非第 11 节建议的线性顺序。

### 0.5.2 文档 ↔ 代码命名对照

> 本文上半部分用 `kb_*` 命名命令，**代码实际用 `*_knowledge_*`**。表名仍是 `kb_*`。对照如下：

| 文档写法（旧） | 代码实际命令 | 表名 |
|---|---|---|
| `list_kb_cards` | `list_knowledge_cards` | `kb_cards` |
| `get_kb_card` | `get_knowledge_card` | `kb_cards` |
| `upsert_kb_card` | `upsert_knowledge_card` | `kb_cards` |
| `confirm_kb_card` | `confirm_knowledge_card` | — |
| `reject_kb_card` | `reject_knowledge_card` | — |
| `delete_kb_card` | `delete_knowledge_card` | — |
| `list_cards_by_chunk` | `list_knowledge_cards_by_chunk` | — |
| （新增）地图 | `get_book_knowledge_map` | — |
| （新增）图谱 | `build_knowledge_graph` / `get_knowledge_graph` | `kb_edges` |
| （新增）健康度 | `knowledge_health` | — |
| （新增）漂移 | `list_knowledge_drift` | — |

### 0.5.3 已知偏离与技术债（偿还进度，见 P10）

> 进度更新（2026-06-07，全部完成一轮）：`knowledge.rs` 拆分、git 纳管、前端纯函数层、P3 惰性补全、`storage.rs` 瘦身（测试 + types 抽取）均已落地，140 个 Rust 测试 + 267 个前端测试全绿。

| 偏离项 | 计划/铁律要求 | 状态 | 严重度 |
|---|---|---|---|
| **架构未拆分** | 第 3 节要求 `knowledge/` 目录；coding-style 要求 200–400 行/文件、禁止 >800 行 | ✅ **已拆分**：`knowledge.rs` 4557 → `knowledge/`(mod 2978 + types 263 + schema 103 + text_utils 416 + export 165 + lazy 200 + tests 766)。mod.rs 仍 ~2978 行(DB 核心高耦合),进一步细拆为可选项 | 🟡 中（已大幅缓解） |
| **storage 膨胀** | 「storage.rs 只做薄 DB helper」 | ✅ **已大幅瘦身**：`storage.rs` 5984 → `storage/`(mod 3689 + types 407 + tests 1897)。mod.rs 仍 3689 行(生产逻辑高耦合),按主题细拆为可选项 | 🟡 中（已大幅缓解） |
| **前端纯函数层缺失** | 第 3 节要求 `src/core/knowledge-export.ts` / `knowledge-display.ts` + 单测 | ✅ **已补**：两文件 + 27 个单测（empty/single/multi）；`KnowledgePanel.tsx`/`App.tsx` 已改用共享纯函数，删除内联重复与死代码 | — 已解决 |
| **未纳入 git** | 第 9 节全部 gate/PR 流程基于 commit | ✅ **已纳管**：知识系统已提交到 `anbc_dev` 分支，按步骤切了 12+ 个可回滚 commit；`0_reference/`、`*.dmg` 已加入 `.gitignore` | — 已解决 |
| **P3 惰性补全缺失** | P3 核心交付 | ✅ **已实现**：`get_or_generate_highlight_note` / `get_or_generate_card_summary`（TLDR 缓存 + source_version；force 不绕过 user_lock）；2 命令注册 + 3 守卫测试 | — 已解决 |
| **测试密度不足** | 每条能力都有单测 | ⚠️ 改善：新增 30 个测试（27 前端纯函数 + 3 P3 守卫）；P5 反思/纠错等仍可继续补 | 🟡 中（持续项） |

**决策（2026-06-07）**：架构偏离按**技术债处理**，代码向计划看齐。**本轮 P10 全部高优先项已完成**（12+ 步增量提交，每步 `cargo test` / `pnpm test` 全绿）。剩余为持续优化项：`mod.rs`/`storage.rs` 按主题进一步细拆（可选，风险递增）、P5 测试补充。

---

## 0. 总方向

最终目标不是复制 shiji-kb 的《史记》人工策展成果，而是把它的工程纪律和查阅体验迁移到任意 PDF 精读场景：

```text
导入一本书
  → 解析成 chunks（已有）
  → 用户高亮 / AI 解读 / 追问 / 笔记
  → 自动沉淀成知识卡片
  → 每张卡片绑定原文证据 chunk
  → 可搜索、可跳转、可导出
  → 进一步生成实体/概念索引、事件时间线、关系反链
```

核心路线：

1. **先做阅读成果沉淀层**：高亮、解读、笔记统一变成可查的知识卡片。
2. **再做知识抽取层**：实体、概念、事件、关系全部作为 `candidate`，用户确认后才升级。
3. **最后做可视化和 RAG 增强**：章节地图、时间线、反链、`search_knowledge` 工具。

---

## 1. 不可破坏的工程铁律

这些规则进入所有阶段的 code review checklist：

| 铁律 | 要求 | 失败判定 |
|---|---|---|
| 原文只读 | 不向 `chunks.text` / `chunks.markdown` 内联实体标记 | 任何 `〖@〗`、HTML span、wiki link 写入原文字段 |
| 引用接地 | AI 最终引用仍只认 `[chunk_id]` | 知识卡片 ID、实体 ID 被当成最终引用证据 |
| 坐标唯一 | 所有跳转仍经 `chunk_id -> chunks.rects_json` | 新知识层自己保存 PDF 坐标并绕过转换函数 |
| 单书作用域 | 所有查询必须带 `book_id` | 自动跨书合并实体或跨书冲突检测 |
| append-only | 自动流程只新建/补空，不覆盖用户内容 | 覆盖 `user_locked`、`confirmed`、用户编辑过的正文/摘要 |
| 置信分层 | 自动抽取默认 `candidate`，必须显示来源和置信度 | UI 把 LLM 候选显示成事实 |
| 时间克制 | `time_norm` 仅在文本明确时填写；推断必须标注 | 自动给无依据事件写精确年份 |
| 密钥后端 | LLM / embedding / MinerU key 只在 Rust 后端 | 前端 bundle、localStorage 或导出文件包含 key |

---

## 2. 最终能力范围

### 2.1 用户可见能力

- 知识面板：右侧可折叠面板，包含「笔记 / 索引 / 地图 / 关联 / 导出」。
- 知识卡片：高亮、解读、追问、概念、实体、事件、论点都统一成卡片。
- 原文证据：每张卡片都显示引用摘录、页码、chunk_id，并可跳回原文。
- 可信度提示：解读引用是否全部接地、历史引用是否漂移、知识候选是否待确认。
- Markdown 知识册：一键导出本书阅读沉淀，含总览表和详情记录。
- 应用/迁移解读：用户 opt-in，让 AI 基于证据讲「这段原理如何迁移到当前场景」。
- 实体/概念索引：查看人物、地点、组织、概念、作品、术语的出现位置和相关解读。
- 时间线/章节地图：章节线 + 事件/概念站点 + 关联线，点击站点回到原文。
- 反链/关系：卡片之间的共证据、邻近、支持、对比、因果候选。

### 2.2 内部能力

- `knowledge` Rust 模块：schema、卡片、证据、导出、抽取、关系、查询。
- Tauri commands：知识卡片 CRUD、导出、构建、搜索、确认/拒绝/合并。
- `search_knowledge` RAG 工具：把知识层转回 evidence chunks，不改变最终 citation 协议。
- product self-check 扩展：覆盖知识卡片、导出、跳转和 append-only。

---

## 3. 总体架构

```text
src-tauri/src/
  storage.rs                 # 仅保留 schema 初始化和薄 DB helper，避免继续膨胀
  knowledge/
    mod.rs
    schema.rs                # 表定义常量、迁移检查、版本号
    cards.rs                 # kb_cards CRUD + append-only upsert
    evidence.rs              # kb_evidence 绑定、chunk 校验、hash 漂移检查
    export.rs                # Markdown / JSON 导出
    query.rs                 # 搜索卡片、按 chunk 反查卡片、转 SearchHit
    extract.rs               # 实体/概念候选抽取
    reflect.rs               # LLM 多轮反思和置信修正
    events.rs                # 事件抽取、time_order、地图数据
    relations.rs             # auto 边、LLM 边、反链
    prompts.rs               # 抽取/反思/补全 prompt 模板

src/components/knowledge/
  KnowledgePanel.tsx
  KnowledgeCardList.tsx
  KnowledgeCardDetail.tsx
  KnowledgeExportDialog.tsx
  KnowledgeMap.tsx
  KnowledgeRelations.tsx
  EntityDetailCard.tsx

src/core/
  knowledge-export.ts        # 前端可复用导出/预览纯函数
  knowledge-display.ts       # 状态、来源、置信度展示规则

src/stores/reader-store.ts   # knowledge slice
```

设计约束：

- `storage.rs` 不承载复杂业务逻辑；新增逻辑进入 `knowledge/`。
- 前端展示组件必须有 Storybook；状态至少覆盖正常、空、加载、错误、低置信、已确认、用户锁定。
- 所有核心纯函数有单测。

---

## 4. 数据模型目标

第一版采用「通用卡片 + 证据 + 关系」作为地基。实体、事件先作为 `card_type` 和 `payload_json`，等质量稳定后再拆专表。

### 4.1 核心表

- `kb_cards`
  - `card_id`
  - `book_id`
  - `card_type`: `note | highlight | interpretation | concept | entity | event | claim | question | summary`
  - `title`
  - `summary`
  - `body_markdown`
  - `payload_json`
  - `status`: `candidate | confirmed | rejected`
  - `source`: `user | highlight | interpretation | auto | llm | reflected`
  - `confidence`
  - `source_version`
  - `user_locked`
  - `created_at`
  - `updated_at`

- `kb_evidence`
  - `card_id`
  - `book_id`
  - `chunk_id`
  - `page_index`
  - `quote`
  - `role`: `support | context | counterpoint | source`
  - `content_hash`
  - `created_at`

- `kb_edges`
  - `edge_id`
  - `book_id`
  - `source_card_id`
  - `target_card_id`
  - `edge_type`: `backlink | same_evidence | nearby | co_mention | user_link | supports | contrasts | causes | sequel | part_of`
  - `label`
  - `evidence_chunk_ids_json`
  - `source`
  - `confidence`
  - `status`
  - `created_at`
  - `updated_at`

- `kb_build_runs`
  - `run_id`
  - `book_id`
  - `task`: `cards | entities | events | relations | map | export`
  - `source_version`
  - `status`: `queued | running | succeeded | failed | cancelled`
  - `progress_json`
  - `error_message`
  - `started_at`
  - `finished_at`

### 4.2 后续可拆专表

当实体/事件索引质量稳定后再考虑：

- `kb_mentions`: entity card 的 surface form、chunk、offset、置信度。
- `kb_event_participants`: event card 与 entity card 的参与关系。
- `kb_aliases`: entity card 的别名和合并历史。

拆表条件：

- 通用 `kb_cards + payload_json` 已无法支撑查询性能或 UI 复杂度。
- 已有明确用户价值，不是为了模拟 shiji-kb 的本体完整性而拆。

---

## 5. 完整开发任务清单

### P0. 方案收敛与工程纪律

目标：所有 agent 后续按同一份边界开发。

- [x] 将本文件加入 README 文档地图。
- [x] 在 `AGENTS.md` 铁律中补充「知识层 append-only、不污染原文、不升级为引用证据」。
- [x] 明确本阶段不做跨书图谱、不做绝对纪年推断、不做内联实体标注。
- [x] 为知识层定义 `KB_SOURCE_VERSION` 常量和迁移策略。

Check 目标：

- [x] 新 agent 只读本文件就能判断哪些能力该做、哪些不能做。
- [x] README 中的知识层文档链接有效。
- [ ] `git diff` 不包含无关代码重构。

验收：

- 文档 review 通过。
- 无测试要求；本阶段只改文档。

---

### P1. 低风险体验增强

目标：不建复杂知识抽取，也能立刻提升查阅体验。

任务：

- [x] 解读可信度徽章
  - 后端把引用校验结果结构化为 `grounded_citation_count`、`dropped_citation_count`、`answer_source`。
  - 前端 `InterpretationCard` 显示全部可核验 / 部分丢弃 / 本地降级。
  - 证据：`interpretation.rs` 的 `AnswerSource`、`InterpretationCard.tsx:228 interpretationTrustState`。
- [x] 引用漂移提示
  - 加载历史解读时比对 `evidence_chunk_snapshots_json.content_hash` 和当前 chunk hash。
  - UI 标注「原文已重解析，引用需复核」。
  - 证据：`knowledge.rs list_drift` / `list_drift_for_conn`，面板显示「漂移 N」。
  - ⚠️ 待核：`evidence_chunk_snapshots` 在 `interpretation.rs:3555` 当前为空集合，历史解读侧漂移链路需复测。
- [x] Markdown 知识册导出 v0
  - 读取 `interpretations`、`highlights`。
  - 导出格式：总览表 + 详情记录 + 原文选区 + 证据 chunk 列表。
  - 不调用 LLM，不创建实体。
- [x] 应用/迁移解读模式
  - `InterpretMode` 增加 `Apply` 或 `Transfer`。
  - Prompt 要求基于证据 `[chunk_id]`，禁止空泛建议。
  - 前端增加一个明确的 opt-in 按钮。
  - 证据：`interpretation.rs:62 InterpretMode::Apply`、`:1378` 分支。

Check 目标：

- [x] 一个已有解读能显示引用可信度。
- [ ] 人为改变 chunk hash 后，历史解读出现漂移提示（卡片侧 ✅，解读历史侧待复测，见上）。
- [x] 只有高亮和解读的书能导出 Markdown。
- [x] 应用/迁移回答仍包含可点击 chunk 引用。

自动化验收：

```bash
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture
pnpm build
```

补充测试：

- [ ] `InterpretationCard` story 覆盖三种可信度状态。
- [ ] `knowledge-export` 纯函数测试覆盖空数据、单高亮、多轮追问。

---

### P2. 知识卡片地基

目标：高亮、解读、笔记统一沉淀成可查、可跳转、可导出的卡片。

后端任务：

- [x] 新增 `knowledge` 模块目录。
- [x] 新增 `kb_cards`、`kb_evidence`、`kb_edges`、`kb_build_runs` 表。
- [x] 实现 append-only upsert：
  - `user_locked = 1` 不覆盖。
  - `status = confirmed` 不覆盖。
  - 非空 `summary/body_markdown` 不被自动重写。
- [x] 保存高亮时可创建 `note/highlight` card。
- [x] 保存解读时可创建 `interpretation/question` card。
- [x] 证据绑定时校验 `book_id + chunk_id` 存在。
- [x] 实现卡片 CRUD commands（注意命名见 §0.5.2，代码用 `*_knowledge_*`）：
  - [x] `list_kb_cards` → `list_knowledge_cards`
  - [x] `get_kb_card` → `get_knowledge_card`
  - [x] `upsert_kb_card` → `upsert_knowledge_card`
  - [x] `confirm_kb_card` → `confirm_knowledge_card`
  - [x] `reject_kb_card` → `reject_knowledge_card`
  - [x] `delete_kb_card` 或软删除 → `delete_knowledge_card`
  - [x] `list_cards_by_chunk` → `list_knowledge_cards_by_chunk`
  - [x] `export_book_knowledge_markdown`

前端任务：

- [x] `reader-store.ts` 增加 knowledge slice。
- [x] 新增 `KnowledgePanel`，第一版只启用「笔记」和「导出」。
- [x] 新增 `KnowledgeCardList`、`KnowledgeCardDetail`、`KnowledgeExportDialog`（实际整合进 `KnowledgePanel.tsx` 内部，未拆独立文件）。
- [x] 卡片详情证据按钮复用现有 `onCitationClick(chunkId)`。
- [x] 用户编辑卡片后写 `user_locked = 1`。

Check 目标：

- [x] 保存高亮后，知识面板出现对应卡片。
- [x] 保存解读后，知识面板出现解读卡片并绑定 evidence chunks。
- [x] 点击卡片证据能跳回原文对应页/块。
- [x] 用户编辑后的卡片不会被再次自动生成覆盖。
- [x] 删除书后，知识卡片级联删除。

自动化验收：

```bash
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture
pnpm build
```

必须新增测试：

- [x] Rust：旧库打开自动建表。
- [x] Rust：append-only upsert 不覆盖 locked/confirmed。
- [x] Rust：evidence 外键和级联删除。
- [x] TS：KnowledgePanel 空/加载/错误/正常。
- [x] TS：卡片证据点击回调。
- [x] Storybook：KnowledgePanel 全状态。
- [ ] Storybook：KnowledgeCardDetail、KnowledgeExportDialog 全状态。

---

### P3. 惰性补全与阅读沉淀

目标：知识卡片开始「越读越厚」，但成本可控。

任务：

- [x] `get_or_generate_highlight_note(card_id, force?)` — **已实现**（`knowledge/lazy.rs`）
  - 复用 TLDR 的缓存与 source version 模式。
  - 只在用户点击时生成，不在保存高亮时静默调用 LLM。
- [x] `get_or_generate_card_summary(card_id, force?)` — **已实现**（`knowledge/lazy.rs`）
  - 对长解读/多证据卡片生成一句话摘要。
  - 用户编辑过的摘要不覆盖（`force` 也不绕过 `user_locked`）。
- [x] 高亮、解读、追问收割策略：
  - 默认只创建卡片和 evidence。
  - 实体/关系候选收割放到 P5 以后，且需要开关。
- [x] 知识健康度：
  - 卡片数、已确认数、候选数、引用漂移数、最近更新时间。
  - UI 在知识面板顶部展示。
  - 证据：`knowledge_health` + `KnowledgePanel.tsx:127`「已确认/候选/漂移」。

Check 目标：

- [x] 首次点击「补全笔记」调用 LLM 并写回（后端 `get_or_generate_*` 已就绪；前端按钮接线为后续 UI 任务）。
- [x] 第二次打开同一卡片命中缓存（`is_fresh` + `KB_SOURCE_VERSION`，已有单测）。
- [x] 用户编辑后再次补全不会覆盖，除非明确 `force`（且 `force` 永不绕过 `user_locked`，已有单测）。
- [x] 知识健康度随保存高亮/解读更新。

自动化验收：

```bash
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture
pnpm secret-scan
```

必须新增测试：

- [ ] Rust：source version 命中缓存。
- [ ] Rust：force 逻辑不绕过 user lock。
- [ ] TS：补全 loading/error/success 状态。

---

### P4. RAG 集成：`search_knowledge`

目标：AI 解读能利用用户已经沉淀的知识，但最终引用仍回到原文 chunk。

> ✅ **本阶段代码已实现**（曾长期标为未做）。证据：`llm.rs:67 search_knowledge_tool`、`commands.rs:942`、`knowledge.rs:826/837 search_knowledge_hits`、`interpretation.rs:1184` 分发。

任务：

- [x] `llm.rs::book_retrieval_tools()` 增加 `search_knowledge`。
- [x] `interpretation.rs::execute_retrieval_tool_call()` 分发 `search_knowledge`。
- [x] `knowledge::query` 将卡片结果转成 `Vec<SearchHit>`：
  - 命中卡片标题/摘要/正文。
  - 展开该卡片的 evidence chunks。
  - 返回仍是 chunk 证据，不返回 card id 作为引用。
  - 证据：`search_knowledge_hits` 把 card 命中折算为 `storage::SearchHit`（chunk 级）。
- [x] Prompt 增加说明：知识层是读者沉淀内容，最终回答仍必须引用原文 `[chunk_id]`。
  - 证据：`interpretation.rs:1978`。
- [ ] RAG trace 中显示 `search_knowledge` 调用和命中卡片标题（待核 trace 展示）。

Check 目标：

- [x] 针对已有卡片提问时，模型会调用 `search_knowledge` 或检索到同一 evidence chunk。
- [x] 最终回答没有 `[kb-card-*]` 之类引用（命中转 chunk evidence 后才入证据集）。
- [x] `enforce_grounded_citations` 不需要为知识层开特殊通道。
- [x] 未构建知识层的书仍按原有 `search_book` 流程工作。

自动化验收：

```bash
pnpm eval:rag
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture
```

必须新增测试：

- [ ] Rust：`search_knowledge` 只返回当前 `book_id`。
- [ ] Rust：知识命中转 SearchHit 后仍可被 citation 校验。
- [ ] RAG eval：加入一组“先沉淀知识卡片，再追问”的 fixture。

---

### P5. 实体/概念索引

目标：构建单书内可查的实体/概念候选库，支持出现位置和相关解读。

> ⚠️ **部分实现**：entity/concept card 类型已落库、`extract_event_sentences` 等 auto 轨存在；**反思轨、别名/合并历史、纠错 UI 仍待补**。下方勾选框保持以反映剩余工作。

任务：

- [ ] 候选生成 auto 轨：
  - 从高亮选区、卡片标题、章节标题、书名号/引号内容、FTS 高频词提取。
  - 写入 `kb_cards(card_type='entity' | 'concept')`，默认 `candidate`。
- [ ] LLM 识别轨：
  - 分章节/小节批量识别 `person/place/org/concept/work/other`。
  - 输出 JSON，带 aliases、confidence、evidence chunks。
- [ ] 反思轨：
  - 类型一致性检查。
  - 合并/拆分建议。
  - 高频普通词噪声清理。
- [ ] 用户纠错：
  - 确认、改名、合并、拒绝。
  - 保留 aliases 和合并历史。
- [ ] UI：
  - 知识面板「索引」tab。
  - `EntityDetailCard` 显示摘要、别名、提及列表、相关解读。
  - 低置信候选明确标注。

Check 目标：

- [ ] 一本普通书能生成实体/概念候选。
- [ ] 点实体能看到出现位置，并跳回原文。
- [ ] 误报可以拒绝，拒绝后不再默认显示。
- [ ] 合并两个候选后，原别名保留，证据合并。
- [ ] 所有 LLM 结果默认不是 `confirmed`。

自动化验收：

```bash
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture
pnpm secret-scan
```

人工样本验收：

- [ ] 中文非虚构书：抽出人物/概念。
- [ ] 英文论文：抽出术语/作品/组织。
- [ ] 小说：不把大量普通名词显示成事实索引。

质量指标：

- Top 30 候选中明显垃圾词不超过 20%。
- 所有候选都有至少一个 evidence chunk。
- 用户拒绝项不会在重抽取后重新冒出来，除非 source version 升级并保留历史。

---

### P6. 事件时间线 / 章节地图

目标：实现 shiji 地铁图启发的单书导航视图。

> ✅ **本阶段代码已实现**（曾标为未做）。证据：`knowledge.rs get_book_knowledge_map`、前端 `KnowledgeChapterMap.tsx` + `KnowledgeTimeline.tsx`。下方勾选框按已实现校准；剩余主要是「时间纪律」边界用例的样本验收。

任务：

- [ ] `knowledge/events.rs`：
  - 按章节/小节抽取事件或关键论点。
  - 写入 `kb_cards(card_type='event' | 'claim')`。
  - `payload_json` 包含 `time_raw/time_norm/time_order/time_source/people/places`。
- [ ] 时间纪律：
  - `time_raw` 照抄文本。
  - `time_norm` 仅文本明确时填写。
  - `time_order` 永远可用，按章节和 chunk 顺序生成。
  - `llm_inferred` 必须在 UI 标注。
- [ ] `get_book_knowledge_map(book_id)`：
  - 返回 `lines/stations/transfers`。
  - `lines` = 章节/小节。
  - `stations` = event/claim/concept/note。
  - `transfers` = same_evidence/nearby/user_link。
- [ ] 前端：
  - `KnowledgeMap.tsx` 第一版用 SVG 或列表化时间线。
  - 支持搜索站点、点击站点看卡片、跳原文。

Check 目标：

- [ ] 没有绝对时间的书仍能按阅读顺序生成地图。
- [ ] 有明确日期的书能显示 `time_raw/time_norm`。
- [ ] 推断时间有醒目标注。
- [ ] 点击站点能跳到原文 evidence。

自动化验收：

```bash
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture
pnpm build
```

人工样本验收：

- [ ] 历史/传记类：时间线可读。
- [ ] 论文/教材类：按章节逻辑顺序可读。
- [ ] 小说类：按叙事顺序可读，但不伪造绝对年份。

---

### P7. 关系、反链和轻量图谱

目标：建立可解释的导航关系，而不是权威图谱。

> ✅ **本阶段代码已实现**（曾标为未做）。证据：`knowledge.rs build_knowledge_graph` / `get_knowledge_graph`、前端 `KnowledgeBacklinks.tsx` + `KnowledgeGraphView.tsx`（`kb_edges` 表）。剩余主要是 LLM 边触发策略与确认 UI 的样本验收。

任务：

- [ ] auto 边：
  - `same_evidence`：引用同一 chunk。
  - `nearby`：证据 chunk 相邻。
  - `backlink`：卡片正文链接另一卡片。
  - `user_link`：用户手动建立。
- [ ] LLM 边：
  - 只对高频、高置信、用户关注卡片对触发。
  - 类型限定 `supports/contrasts/causes/sequel/part_of`。
  - 必须绑定 evidence chunks，默认 `candidate`。
- [ ] UI：
  - 卡片详情显示相关卡片和反链。
  - 第一版以列表为主；力导向图放后续增强。
- [ ] 关系确认：
  - 用户可确认/拒绝 LLM 边。
  - 被拒绝的边不再自动显示。

Check 目标：

- [ ] 任意卡片能看到“哪些卡片引用了同一原文”。
- [ ] 用户手动链接两个卡片后立即可见。
- [ ] LLM 关系不带证据时被拒绝入库或降级。
- [ ] 图谱视图不把 candidate 边显示成事实。

自动化验收：

```bash
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture
```

---

### P8. 导出、备份与可迁移性

目标：用户能把一本书的阅读成果带走，且导出内容可审计。

任务：

- [ ] Markdown 知识册 v1：
  - 书籍信息。
  - 高亮/解读/笔记总览表。
  - 实体/概念索引。
  - 时间线/地图站点表。
  - 关系/反链摘要。
  - 每条详情包含 evidence chunk、页码、quote、状态、来源。
- [ ] JSON 导出：
  - `kb_cards/kb_evidence/kb_edges` 原始结构。
  - 不导出 API key、本地绝对敏感路径。
- [ ] 导出文件名稳定：
  - `书名-知识册-YYYYMMDD.md`
  - `书名-knowledge-YYYYMMDD.json`
- [ ] 导出预览：
  - 前端 Dialog 预览前若内容过长，显示摘要和保存按钮。

Check 目标：

- [ ] 空知识库导出有友好说明。
- [ ] 含中文/英文/公式 markdown 的卡片导出不破坏格式。
- [ ] 所有详情记录都能追溯 chunk。
- [ ] 导出不包含 `.env`、API key、本机隐私路径。

自动化验收：

```bash
pnpm test
pnpm secret-scan
```

---

### P9. 产品自检与发布级验收

目标：把知识层纳入现有健康检查和真实窗口验收。

任务：

- [ ] 扩展 `product_self_check`：
  - 创建临时书。
  - 保存高亮并生成 note card。
  - 保存解读并生成 interpretation card。
  - 绑定 evidence。
  - 导出 Markdown。
  - 重新打开 DB 后验证 card/evidence 仍在。
  - 验证 append-only 不覆盖用户编辑。
- [ ] 扩展 `scripts/rag_eval.mjs`：
  - 加知识卡片 fixture。
  - 检查 `search_knowledge` 不降低原检索 recall。
- [ ] 增加真实窗口 E2E checklist：
  - 导入 PDF。
  - 高亮。
  - 解读。
  - 知识面板出现卡片。
  - 证据跳转。
  - 导出知识册。
  - 关闭重开恢复。
- [ ] 长书压测：
  - 500+ 页 PDF。
  - 知识面板打开不卡死。
  - 卡片列表分页或虚拟化。

最终自动化验收：

```bash
pnpm health
pnpm health:bundle
```

最终人工验收：

- [ ] 打开 debug `.app`，主界面非白屏。
- [ ] 真实 PDF 完成导入、搜索、解读、知识卡片、导出闭环。
- [ ] 关闭重开后书籍、历史、高亮、知识卡片恢复。
- [ ] 500+ 页 PDF 不出现明显卡死或内存异常。
- [ ] Storybook 走查所有知识组件状态。

---

### P10. 工程债偿还（架构对齐）

> 新增于 2026-06-07 对账。决策：架构偏离按技术债处理，**代码向计划/coding-style 看齐**，不放宽约束。详见 §0.5.3。

目标：消除已知架构偏离，让真实代码结构与第 3 节蓝图和全局 coding-style 铁律一致。

任务（建议按依赖顺序）：

- [x] **纳入 git（最高优先，前置）**：
  - 知识系统已提交到 `anbc_dev` 分支；`0_reference/`(155M)、`*.dmg` 已加入 `.gitignore`。
  - 已按步骤切 6 个可回滚 commit（baseline + 5 次模块抽取），第 6/9 节 gate/PR 流程现可真实验证。
- [x] **拆分 `knowledge.rs`（4557 行 → `knowledge/` 目录）**：
  - 已拆为 `mod.rs(2970) / types.rs(263) / schema.rs(103) / text_utils.rs(416) / export.rs(165) / tests.rs(673)`。
  - 采用「中粒度 5 文件」策略（私有 helper 高度共享，细拆 churn 过大）；submodule 用 `use super::*` 共享父作用域。
  - **行为等价已验证**：每步 `cargo test --lib knowledge::` 12 通过，最终全量 137 Rust 测试全绿、0 warning、tsc 干净。
  - ⚠️ 备注：`mod.rs` 仍 2970 行（cards CRUD / graph / query / extract 高耦合 DB 核心）。进一步细拆为 `cards/graph/query` 风险较高（需大量 `pub(super)` + 跨文件重写），按 ROI 暂缓，留作后续可选项。
- [x] **`storage.rs` 瘦身（5984 行）**：
  - 已转 `storage/` 目录：`mod.rs(3689) / types.rs(407) / tests.rs(1897)`。
  - 测试块 + 公共类型抽取，行为等价（`cargo test -- --test-threads=1` 140 通过、0 warning）。
  - ⚠️ 备注：`mod.rs` 仍 3689 行（books/search/highlights/interpretation/tldr 生产逻辑 + 84 个私有 helper 高耦合）。按主题继续细拆为可选项，风险递增。
- [x] **补前端纯函数层**：
  - 已新增 `src/core/knowledge-display.ts`（标签/状态/来源/置信度/漂移规则 + 规范卡片类型表）+ `knowledge-export.ts`（稳定文件名 `书名-知识册-YYYYMMDD`、空导出检测、预览截断）。
  - 27 个单测覆盖 empty/single/multi；`KnowledgePanel.tsx`/`App.tsx` 改用共享纯函数，删除内联重复与死代码 `safeDownloadName`。
- [ ] **补测试密度**（持续项）：
  - 已新增 30 个测试（27 前端纯函数 + 3 P3 守卫）。P5 反思/纠错、地图/图谱空数据等仍可继续补。

Check 目标：

- [x] `wc -l src-tauri/src/knowledge/mod.rs` 不再是单一巨文件；`knowledge/` 目录存在（7 个文件）。
- [x] `storage.rs` 行数显著下降（5984 → mod 3689 + 拆出 2304 行）。
- [x] `git ls-files` 能列出 knowledge 模块与组件（不再 untracked）。
- [x] 拆分前后 `cargo test`（140 通过）/ `pnpm test`（267 通过）/ `tsc`（干净）全绿，行为等价。

自动化验收：

```bash
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture
pnpm build
```

> ⚠️ 纪律：P10 是**纯重构 + 纳管**，不得借机改业务行为；任何行为变更必须单独立项。

---

## 6. 阶段 gate 总表

| Gate | 必须交付 | 自动命令 | 人工检查 | 真实状态(2026-06-07) |
|---|---|---|---|---|
| G0 文档 gate | 本文 + README 链接 + AGENTS 规则 | 无 | 边界清楚，无破坏铁律 | ✅ 达成（git 纳入除外） |
| G1 体验增强 gate | 可信度、漂移、导出 v0、应用模式 | `pnpm test && pnpm build` | 解读卡片状态正确 | ✅ 基本达成（解读历史漂移待复测） |
| G2 卡片地基 gate | `kb_cards/evidence/edges` + KnowledgePanel | `pnpm test && cargo test` | 保存高亮/解读后有卡片 | ✅ 达成 |
| G3 沉淀 gate | 惰性补全、健康度、append-only | `pnpm test && cargo test` | 用户编辑不被覆盖 | ⚠️ 部分（惰性补全缺失） |
| G4 RAG gate | `search_knowledge` 工具 | `pnpm eval:rag && cargo test` | 最终引用仍是 chunk_id | ✅ 达成 |
| G5 索引 gate | 实体/概念候选 + 纠错 | `pnpm test && cargo test` | 低置信标注清楚 | ⚠️ 部分（纠错/反思待补） |
| G6 地图 gate | 章节线/站点/时间纪律 | `pnpm test && pnpm build` | 无年份书也可读 | ✅ 基本达成（样本验收待补） |
| G7 关系 gate | 反链/auto 边/LLM 边 | `pnpm test && cargo test` | candidate 不冒充事实 | ✅ 基本达成（样本验收待补） |
| G8 发布 gate | 自检、bundle、真实窗口 E2E | `pnpm health:bundle` | 真实 PDF 闭环通过 | ⚠️ 待核（结果未回填） |
| G10 工程债 gate | 拆分 `knowledge/`、瘦身 storage、纳入 git、补纯函数层 | `pnpm test && cargo test && pnpm build` | 结构对齐第 3 节、行为等价 | ❌ 未开始 |

禁止跳 gate：

- G2 未完成前，不做实体/事件大规模抽取。
- G4 未完成前，不允许知识层参与 RAG 主链路。
- G5 未完成前，不做关系图谱。
- G8 未完成前，不宣称知识层完成。
- G10 是债务清理 gate：可与发布并行，但**架构债未还清前，不得在 §0.5.3 标注的偏离项上叠加新业务逻辑**（避免债务继续滚大）。

---

## 7. 最终验收体系

### 7.1 功能验收

用一本 100-200 页真实 PDF：

- [ ] 导入并完成解析、FTS 索引。
- [ ] 保存 3 条高亮。
- [ ] 对 2 条高亮做深度解读。
- [ ] 做 1 次应用/迁移解读。
- [ ] 知识面板显示至少 5 张卡片。
- [ ] 每张自动卡片都有 evidence chunk。
- [ ] 点击任意 evidence 能跳回原文。
- [ ] 导出 Markdown 知识册，包含总览表和详情。
- [ ] 关闭重开后全部恢复。

### 7.2 质量验收

- [ ] 自动生成内容全部显示来源。
- [ ] LLM 候选全部默认 `candidate`。
- [ ] 用户确认后显示为 `confirmed`。
- [ ] 用户拒绝后默认不再显示。
- [ ] 引用漂移能被发现并提示。
- [ ] 没有任何知识内容污染原文 chunk。

### 7.3 接地验收

- [ ] 解读回答中的引用都能被 `enforce_grounded_citations` 校验。
- [ ] `search_knowledge` 结果最终转成 chunk evidence。
- [ ] 不存在 card id / entity id 作为最终 citation。
- [ ] 无 evidence 的内容不能进入 AI 证据集。

### 7.4 数据验收

检查 SQLite：

- [ ] `kb_cards.book_id` 全部存在于 `books`。
- [ ] `kb_evidence(book_id, chunk_id)` 全部存在于 `chunks`。
- [ ] 删除测试书后，知识表无孤儿数据。
- [ ] `user_locked=1` 的卡片不被自动 upsert 改写。
- [ ] `confirmed` 的卡片不被自动降级。

### 7.5 性能验收

用 500+ 页 PDF：

- [ ] 知识面板首次打开 < 2s 或有明确 Skeleton。
- [ ] 卡片列表分页/虚拟化，滚动不卡顿。
- [ ] 搜索知识卡片 < 1s（本地 DB）。
- [ ] 地图视图不会一次性渲染不可控 DOM 节点。
- [ ] 峰值内存记录在验收日志中。

### 7.6 安全验收

- [ ] `pnpm secret-scan` 通过。
- [ ] 导出 Markdown/JSON 不含 API key。
- [ ] 前端代码不读取 `.env`。
- [ ] 所有 LLM 调用经 Rust 后端。

### 7.7 发布验收

必须通过：

```bash
pnpm health
pnpm health:bundle
```

人工补充：

- [ ] 打开生成的 `.app`，确认非白屏。
- [ ] 设置页 product self-check 通过。
- [ ] 真实窗口 E2E 通过。
- [ ] Storybook 构建和知识组件走查通过。

---

## 8. 测试资产要求

至少准备三类测试书：

| 类型 | 用途 | 验收重点 |
|---|---|---|
| 中文非虚构/名著 | 常规精读 | 高亮、解读、知识卡片、导出 |
| 英文论文/教材 | 英文术语与结构 | 实体/概念候选、章节地图 |
| 500+ 页长书 | 性能压测 | 导入、索引、知识面板性能 |

推荐固定 fixtures：

- 小型内置 sample book：用于单测和 product self-check，不消耗 API。
- `0_book/财富公式.pdf`：用于真实窗口 E2E。
- 500+ 页 PDF：用于性能验收。

---

## 9. 每个 PR 的最低检查清单

通用：

- [ ] 没有改动无关文件。
- [ ] 没有覆盖用户现有未提交改动。
- [ ] 新增后端逻辑有 Rust 单测。
- [ ] 新增前端纯逻辑有 TS 单测。
- [ ] 新增组件有 Storybook。
- [ ] 任何知识写入路径遵守 append-only。
- [ ] 任何新引用路径最终回到 chunk_id。

涉及数据库：

- [ ] 旧库迁移测试。
- [ ] 外键和级联删除测试。
- [ ] source_version 测试。

涉及 LLM：

- [ ] 未配置 key 时有降级或明确错误。
- [ ] 不在前端暴露 key。
- [ ] 有成本控制：惰性、分页、限轮、缓存。

涉及 UI：

- [ ] 空/加载/错误/禁用态齐全。
- [ ] 低置信和候选态不冒充事实。
- [ ] 小屏布局不靠散落 `isMobile()`。

合并前命令：

```bash
pnpm health
```

发布候选额外命令：

```bash
pnpm health:bundle
```

---

## 10. 风险登记表

| 风险 | 等级 | 对策 |
|---|---|---|
| 自动 NER 质量差 | 高 | P5 之前先做卡片地基；候选态、用户确认、可拒绝 |
| 知识层破坏引用信任 | 高 | 只作为检索增强；最终引用仍用 chunk_id |
| LLM 成本失控 | 中 | 惰性生成、分批、缓存、source_version、用户触发 |
| `storage.rs` 继续膨胀 | 中 | 新业务进 `knowledge/`，storage 只做薄 DB helper |
| UI 过重影响阅读 | 中 | 知识面板可折叠，地图后置，列表先行 |
| 关系图谱伪权威 | 中 | auto/LLM/source/status 明确显示，candidate 默认 |
| 长书性能 | 中 | 分页、虚拟化、按需构建、build_runs 进度 |
| 时间线虚假精确 | 高 | `time_raw/time_norm/time_order/time_source` 分层 |

---

## 11. 后续开发顺序建议

> ⚠️ 下面「原始线性顺序」是历史蓝图。截至 2026-06-07，P2/P4/P6/P7 已实现，故**真实剩余工作**见「当前推荐顺序」。

### 原始线性蓝图（历史，仅供参考）

1. **先做 P0 + P1**：最快得到用户感知收益，且不引入复杂抽取风险。
2. **再做 P2 + P3**：建立统一知识卡片地基，这是所有后续能力的地基。
3. **然后做 P4**：把知识层接入 RAG，但严格保持 chunk 引用。
4. **确认用户真的需要后，再做 P5/P6/P7**：实体、时间线、关系网。
5. **P8/P9 贯穿每阶段**：导出和验收不能最后补，否则会积累不可见债务。

### 当前推荐顺序（基于 §0.5 真实状态）

1. **P10 第一步——纳入 git**：让所有后续 gate/PR 流程可验证（最高优先，零业务风险）。
2. **P10 第二步——架构对齐**：拆分 `knowledge.rs` → `knowledge/`、瘦身 `storage.rs`、补前端纯函数层（趁代码量还能控时还债）。
3. **补 P3 惰性补全 + 测试密度**：把"已实现但缺测/缺惰性生成"的窟窿补上。
4. **收尾 P5 反思/纠错 + P8 导出 v1 + P9 自检/压测并回填结果**。
5. **再考虑 P6/P7 的样本验收与增强**（力导向图、LLM 边策略等）。

一句话判断：

> 任何新能力如果不能回答“它如何回到原文 chunk、如何不覆盖用户内容、如何在 UI 中标明来源”，就暂缓实现。

补充纪律：

> 在 §0.5.3 列出的架构债还清前，不要在巨文件（`knowledge.rs`/`storage.rs`）上继续堆新业务——优先还债，避免债务滚大。
