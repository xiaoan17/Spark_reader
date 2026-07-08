# 框选精读 · 单书知识库（精读形态）技术方案

> 产出日期：2026-06-06
> 定位变更：框选精读从「任意 PDF 看一次的解读工具」升级为**纯精读知识库**——每次深耕一本书，每本各自沉淀成独立、可查、可跳转、可视化的持久知识库。类型不限。
> 目标：实现 shiji-kb 的**全部四项能力**——① 持久实体库 ② 事件时间线/地铁图 ③ 关系网 ④「越读越厚」的知识沉淀气质。
> 已对齐的关键决策：
> - **质量路线 = 自动抽取 + 多轮 Agent 反思**（通用规则，非单书 oracle；用户只看低置信项，不靠逐条人工策展）。
> - **先落地 = 持久实体库**（它是时间线与关系网的地基）。
> - **本文是 spec，对齐后再写代码**（遵循 `AGENTS.md` 文档先行流程）。
>
> 本方案所有代码落点均经过对当前真实源码的核对（schema、结构体、工具分发、TLDR 惰性模板、前端 store 形态），下文标注的行号/结构名均来自实读。

---

## 0. 设计总纲：三条不可动摇的原则

shiji-kb 的能力之所以可信，靠的是**人工策展**；我们没有人工策展预算，所以用**多轮 Agent 反思 + 用户阅读时轻量纠错**替代。这决定了三条总纲：

### 原则一：知识层是「叠加层」，永不污染原文与引用接地
- 实体/事件/关系**绝不内联进 `chunks.text`**（会破坏 FTS5、byte-offset 高亮、选区→块映射）。全部 out-of-band 存独立表。
- 知识层**永远不升级为引用级证据**。现有 `enforce_grounded_citations()`（`interpretation.rs:1520`）只认 `[chunk_id]`，这是产品立身之本，不动它。知识层做的是**检索增强 + 导航 + 可视化**，不是替模型背书。
- 每个知识节点都必须**锚定到 `chunk_id`（→ 进而拿到 `rects` 几何坐标）**，保证「点实体→跳回原文高亮」。这是 shiji「原文引用+段落位置」纪律的升级版（我们已有 `chunk_id`+`rects`+`content_hash`，比它更强）。

### 原则二：置信度是一等公民，自动产物默认「待确认」
- 每个实体/事件/关系都带 `confidence`（0..1）+ `source`（`auto` / `llm` / `reflected` / `user`）+ `status`（`candidate` / `confirmed` / `rejected`）。
- **auto 派生**（共现、同页、字符串匹配）= 廉价、确定、高召回但噪声大 → `candidate`。
- **llm 抽取/反思** = 贵、语义、可消歧 → 提升置信但仍 `candidate`。
- **user 确认/纠错** = 唯一能把节点变 `confirmed` 的来源 → 最高优先级，append-only 写回，永不被自动流程覆盖。
- UI 永远区分「已确认」与「AI 推断·待确认」，绝不拿未确认知识冒充事实。

### 原则三：append-only，自动流程绝不覆盖用户与既有确认
直接借 shiji-kb `CLAUDE.md` 第 3 条血泪铁律：
- 目标节点不存在 → 可新建；字段为空 → 可填；**已存在/已确认 → 必须跳过，绝不覆盖**。
- 复用已验证的 `*_SOURCE_VERSION` 版本门控模式（见 `TLDR_SOURCE_VERSION`，`storage.rs:422`）：重抽取时只补空缺、不动用户已改过的节点。
- 这条写进 `AGENTS.md` 铁律表，成为所有知识层写入的统一约定。

---

## 1. 现状地基（已核对的真实代码）

写新表前先钉死现有 schema（`storage.rs:1829-1943`，`open_database()`）：

| 表 | 关键列 | 知识层如何用它 |
|---|---|---|
| `books` | `id`(PK,标题/页数/块哈希) / `total_pages` / `quality_json` / `tldr_*`（已是惰性+版本门控样板） | 知识库按 `book_id` 分库；新增 `kb_*` 进度列挂这里 |
| `pages` | `(book_id, page_index)` PK / `text` / `markdown` | 事件抽取的页级输入 |
| `chunks` | `chunk_id` / `book_id` / `page_index` / `text` / `markdown` / **`rects_json`（归一化坐标=几何真相）** / `coordinate_version`，`UNIQUE(book_id, chunk_id)` | **所有知识节点 FK 到此**，借 `rects` 实现跳转高亮 |
| `chunks_fts` | FTS5(`chunk_id`,`text`,`markdown`) | 实体提及定位、检索增强 |
| `highlights` | `rects_json` + `position_start/end` + `prefix/suffix` | 用户高亮 → 触发实体 stub |
| `interpretations` | `evidence_chunk_ids_json` + **`evidence_chunk_snapshots_json`（带 `content_hash`）** + `kind`(`Interpretation`/`Spark`/`Note`) + `answer_source`(`Llm`/`LocalFallback`) | 解读产物 → 知识收割来源（harvest）|
| `chunk_embeddings` | 变维向量，按 provider/model/dim | 实体聚类/同名归并的语义信号 |

**关键已有能力（直接复用，不重造）：**
- 迁移机制：`CREATE TABLE IF NOT EXISTS` + `ensure_column()`（`storage.rs:1946+`）做加列；新表照此追加，**纯增量、不破坏旧库**。
- 惰性生成模板：`get_or_generate_document_tldr()`（`commands.rs:829`）= 「查缓存→比 `source_version`→未命中才生成→`save_book_tldr` 写回」。**这是知识抽取「惰性+版本门控+不覆盖」的现成模板，照抄。**
- 检索原语全是 `book_id` 作用域：`hybrid_search_book` / `get_chunk` / `get_neighbors` / `list_structure`（`interpretation.rs:1040-1059` 分发）。知识工具照此模式加。
- agentic 循环：`MAX_TOOL_ROUNDS=3` / `MAX_TOOL_CALLS_PER_ROUND=4`（`interpretation.rs:849-850`）。反思管线复用同一 `llm::chat` 抽象。
- 工具定义结构：`ToolDefinition { name, description, input_schema }`（`llm.rs:39`），`book_retrieval_tools()`（`llm.rs:113`）返回 vec。
- 跳转：前端 `onCitationClick(chunkId)` 已实现「跳到块所在页+高亮」，实体跳转复用它。

**确认的空白（要新建的）：** 当前**完全没有**实体/NER/事件/关系/知识图谱代码（`storage.rs`/`interpretation.rs`/`llm.rs` 全无）。`entity_index.json` 也未被前后端引用。所以这是**净新增子系统**，不是改造。

---

## 2. 知识层数据模型（新增 SQLite 表）

> 全部 `CREATE TABLE IF NOT EXISTS`，加在 `open_database()` 的 schema 块尾部；FK 到 `chunks(book_id, chunk_id)` 复用 `ON DELETE CASCADE`（删书自动清知识）。所有表带 `book_id`（**严格单书作用域，无跨书**——见 §7）。

### 2.1 实体表 `kb_entities`（Phase 1 核心）
```sql
CREATE TABLE IF NOT EXISTS kb_entities (
  entity_id      TEXT PRIMARY KEY,           -- book_id + 规范名 的稳定哈希
  book_id        TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  canonical_name TEXT NOT NULL,              -- 规范名（消歧后）
  entity_type    TEXT NOT NULL,              -- person|place|org|concept|work|event|other（通用 7 类，见 §3.2）
  aliases_json   TEXT NOT NULL DEFAULT '[]', -- 别名/异写/简称
  summary        TEXT,                       -- 惰性补全的一句话简介（auto_generated 标记）
  mention_count  INTEGER NOT NULL DEFAULT 0,
  first_chunk_id TEXT,                        -- 首次出现块（跳转锚点）
  confidence     REAL NOT NULL DEFAULT 0.0,
  source         TEXT NOT NULL DEFAULT 'auto',     -- auto|llm|reflected|user
  status         TEXT NOT NULL DEFAULT 'candidate',-- candidate|confirmed|rejected
  source_version INTEGER NOT NULL DEFAULT 1,       -- 抽取管线版本，门控重抽
  summary_generated_at TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE(book_id, canonical_name, entity_type)
);
CREATE INDEX IF NOT EXISTS idx_kb_entities_book_type
  ON kb_entities(book_id, entity_type, status, confidence DESC);
```

### 2.2 提及表 `kb_mentions`（实体↔原文的桥）
```sql
CREATE TABLE IF NOT EXISTS kb_mentions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id    TEXT NOT NULL REFERENCES kb_entities(entity_id) ON DELETE CASCADE,
  book_id      TEXT NOT NULL,
  chunk_id     TEXT NOT NULL,                 -- → 借 chunks.rects_json 跳转高亮
  page_index   INTEGER NOT NULL,
  surface_form TEXT NOT NULL,                 -- 该处的字面写法（可能是别名）
  char_offset  INTEGER,                       -- 块内偏移（仅提示，几何为准）
  confidence   REAL NOT NULL DEFAULT 0.0,
  source       TEXT NOT NULL DEFAULT 'auto',
  FOREIGN KEY(book_id, chunk_id) REFERENCES chunks(book_id, chunk_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_kb_mentions_entity ON kb_mentions(entity_id, page_index);
CREATE INDEX IF NOT EXISTS idx_kb_mentions_chunk  ON kb_mentions(book_id, chunk_id);
```

### 2.3 事件表 `kb_events`（Phase 2）
```sql
CREATE TABLE IF NOT EXISTS kb_events (
  event_id     TEXT PRIMARY KEY,
  book_id      TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  event_type   TEXT,                          -- 通用：行动/转折/因果/陈述/对话…（按书自适应，见 §5）
  -- 时间分三层（借 shiji 多层时间纪律，但不强行推断）：
  time_raw     TEXT,                           -- 文本里出现的原始时间串（"三年""1937年""次日"）
  time_norm    TEXT,                           -- 可归一化时才填（ISO/相对序号），否则 NULL
  time_order   INTEGER,                        -- 叙事/逻辑顺序号（无绝对时间也能排时间线）
  time_source  TEXT NOT NULL DEFAULT 'none',   -- none|text_explicit|llm_inferred（推断必标，防虚假精确）
  anchor_chunk_id TEXT NOT NULL,               -- 事件主锚块
  page_index   INTEGER NOT NULL,
  summary      TEXT,
  quote        TEXT,                           -- 原文引用（借 shiji 纪律）
  confidence   REAL NOT NULL DEFAULT 0.0,
  source       TEXT NOT NULL DEFAULT 'llm',
  status       TEXT NOT NULL DEFAULT 'candidate',
  source_version INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  FOREIGN KEY(book_id, anchor_chunk_id) REFERENCES chunks(book_id, chunk_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_kb_events_book_order ON kb_events(book_id, time_order, page_index);
```
事件↔实体多对多：`kb_event_participants(event_id, entity_id, role)`。

### 2.4 关系表 `kb_relations`（Phase 3）
```sql
CREATE TABLE IF NOT EXISTS kb_relations (
  relation_id   TEXT PRIMARY KEY,
  book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_id     TEXT NOT NULL,                 -- entity_id 或 event_id
  target_id     TEXT NOT NULL,
  relation_type TEXT NOT NULL,                 -- 见下「双轨」
  label         TEXT,                          -- 自由文本关系标签（如"父子""反对""引用"）
  evidence_chunk_ids_json TEXT NOT NULL DEFAULT '[]',
  confidence    REAL NOT NULL DEFAULT 0.0,
  source        TEXT NOT NULL DEFAULT 'auto',  -- auto|llm|reflected|user
  status        TEXT NOT NULL DEFAULT 'candidate',
  source_version INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_relations_book_src ON kb_relations(book_id, source_id);
```

**关系的「双轨」**（直接借 shiji-kb `event_relations.json` 的 `auto` vs LLM 分轨，这是**最关键的可负担性杠杆**）：
- **auto 轨（廉价、确定、先做）**：从已有的提及/事件共现免费算出：
  - `co_mention`：两实体在同一/相邻块共现（用 `kb_mentions` + `get_neighbors`）。
  - `co_occurrence`：同页/同节出现。
  - `same_event`：共同参与同一事件（`kb_event_participants` JOIN）。
- **llm 轨（贵、语义、后做、可选）**：父子/君臣/敌对/因果/引用等**需要语义判断**的关系，仅对高频实体对触发 LLM，结果标 `llm` + `confidence`。

---

## 3. Phase 1：持久实体库（先落地，最详）

> 出口标准：拖入一本书 → 自动抽出实体（带类型/置信度）→ 阅读时点击书中任意人物/概念 → 弹出「是谁 + 在书里哪些地方出现 + 一键跳转」→ 点错的能改、能合并、能拒绝，纠正永久保留。

### 3.1 抽取管线（自动 + 多轮反思）
分四步，**全部惰性 + 版本门控**（照 `get_or_generate_document_tldr` 模板）：

**Step A · 候选生成（auto，廉价高召回）**
- 遍历 `chunks`，用轻量规则抽候选 span：
  - CJK：连续 2–4 字专名模式 + 书名号/引号内容 + 高频未登录词（TF 阈值）。
  - 拉丁：大写开头序列、全大写缩写、`Title Case` 短语。
- 这步**不调 LLM**，产出大量 `candidate` 提及，写 `kb_mentions`（`source=auto`，低 `confidence`）。
- 目的：先把「可能是实体的位置」全标出来，召回优先。

**Step B · LLM 批量识别 + 归类 + 消歧（llm）**
- 按页/按节分批，把候选 span + 上下文喂给 LLM，要求输出结构化 JSON（用现有 `llm::chat` 或工具调用）：
  - 每个实体：`canonical_name` / `entity_type`（7 类，§3.2）/ `aliases` / 该提及是否真实体（过滤误报）。
  - **消歧**：同一书内「张总」「张经理」「老张」是否同一人 → LLM 给归并建议 + 置信度。
  - 这是把 shiji `entity_aliases.json` + `disambiguation_map.json` 的**人工产物**，替换成**LLM 按书自动产出 + 置信度**。
- 写/更新 `kb_entities`（`source=llm`，append-only：已 `confirmed` 的不动）。

**Step C · 多轮 Agent 反思（reflected，质量内核，用户选的路线）**
借 shiji「按章反思」的**过程**，去掉它的单书 oracle，用**通用规则**自检。每轮一个独立 LLM pass，只针对 `candidate` 项：
- **轮 1 · 类型一致性**：同名实体被标了不同类型？别名链是否自洽？拆分/合并明显错误？
- **轮 2 · 消歧复核**：被归并的实体，上下文是否真的指同一对象？（对应 shiji「武王=周/秦」难题的通用版——让 LLM 给出「合并/拆分/存疑」+理由）
- **轮 3 · 噪声清理**：高频但其实是通用词的误报（如把「问题」「方法」当概念实体）→ 降置信或标 `rejected`。
- 每轮把**上一轮结论作为上下文注入**（借 shiji「累积上下文」做法），通过的项 `confidence` 提升、`source=reflected`；存疑项保持低置信。
- **轮数自适应**：用 Workflow 编排（你已开 ultracode），可 2–3 轮；连续一轮无新修正即收敛停止（借 shiji「收敛验证」）。

**Step D · 惰性补全简介（lazy，按需）**
- 实体 `summary` **不在抽取时生成**，而在用户首次点击该实体时，照 `get_or_generate_document_tldr` 模板惰性生成（基于该实体所有提及上下文），写回 `summary` + `summary_generated_at`，标 `auto_generated`。
- 用户手改过的 `summary` 永不被自动覆盖（version-gated）。

> **成本控制**：Step A 零 LLM；Step B 每书一次性批量（可分批进度回传，复用 MinerU 分批进度 UI 模式）；Step C 多轮但只过 candidate；Step D 完全按需。整本书的实体库建一次、缓存进 SQLite，重开不重建（和 MinerU 解析缓存同策略）。

### 3.2 通用实体类型（7 类，替代 shiji 的 18 类单书专用）
shiji 的 18 类（邦国/官职/氏族/天文…）是《史记》专用，不可迁移。用**与领域无关的 7 类**：
`person`（人物）/ `place`（地点）/ `org`（组织机构）/ `concept`（概念术语）/ `work`（作品/文献）/ `event`（事件，与 Phase 2 衔接）/ `other`。
- LLM 在 Step B 自由归类到这 7 类；不强行套用任何书专属体系。
- 类型只用于**分组展示和筛选**，不参与接地，分错代价低。

### 3.3 后端落点（确认过的真实位置）
- **新表**：加在 `storage.rs` `open_database()` schema 块（紧随 `interpretations` 表 `1924` 行后），迁移用 `ensure_column` 同款。
- **新模块**：`src-tauri/src/knowledge.rs`（抽取管线 + 反思）——遵守 200–400 行原则，按 `knowledge/extract.rs`、`knowledge/reflect.rs`、`knowledge/query.rs` 拆分。**不要**把这些塞进已 5890 行的 `storage.rs`。
- **storage 只加薄查询函数**：`list_entities(book_id, type?, status?)` / `get_entity_mentions(entity_id)` / `upsert_entity_append_only(...)` / `confirm_entity` / `merge_entities` / `reject_entity`。
- **Tauri 命令**（`commands.rs`，照 `get_or_generate_document_tldr` 风格）：
  - `get_or_build_book_knowledge(book_id, force?)` —— 惰性触发 Step A–C，版本门控。
  - `list_book_entities(book_id, filter)` / `get_entity_detail(entity_id)`（含提及列表+跳转 rects）。
  - `confirm_entity` / `merge_entities` / `reject_entity` / `rename_entity`（用户纠错，写 `source=user, status=confirmed`，append-only）。
  - `get_or_generate_entity_summary(entity_id, force?)`（惰性简介）。

### 3.4 RAG 集成（实体作为新检索工具，不破坏接地）
- `llm.rs::book_retrieval_tools()`（`113` 行）的 vec 加一个工具：
  ```rust
  pub fn find_entity_tool() -> ToolDefinition {
      ToolDefinition {
          name: "find_entity".into(),
          description: "Look up a person/place/org/concept in this book: its summary and where it appears.".into(),
          input_schema: json!({"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}),
      }
  }
  ```
- `interpretation.rs::execute_retrieval_tool_call()`（`1032` match）加一臂 `"find_entity" =>`，调 `knowledge::query`，**把实体的提及块转成 `Vec<storage::SearchHit>` 返回**——这样 `rank_evidence` 和 `enforce_grounded_citations` 完全不用改，实体只是「带来了相关块」，引用仍走 `[chunk_id]`。
- 系统提示（`build_tool_loop_messages`，`1813`）的工具清单行加一句 `find_entity: ...`。

### 3.5 前端落点（确认过的真实位置）
- **新类型**（`reader-store.ts`，紧随现有 `SavedInterpretation` 等）：`KbEntity` / `KbMention`，加 `knowledge` 切片到 `useReaderStore`。
- **新模块** `src/components/knowledge/`：
  - `KnowledgePanel.tsx`：shadcn `Tabs`，Phase 1 先只有「实体」tab（用 `Command`/`ScrollArea` 列表 + 类型 `Badge` 筛选 + 置信度标识）。
  - `EntityDetailCard.tsx`：点实体 → `Popover`/侧栏，显示 `summary`（标「AI·待确认」）+ 提及列表（每条「页 X · 摘录」按钮 → `onCitationClick(chunkId)` 跳转高亮）+ 纠错操作（确认/改名/合并/拒绝）。
- **布局**：`ReaderShell.tsx` 现有三栏 → 右侧解读栏旁增一个可折叠「知识」栏（第 4 栏，`grid` 调整 + 折叠按钮，端无关纯组件）。
- **正文实体高亮（可选增强）**：`MarkdownContent.tsx::renderMarkdownTextWithCitations()` 已有「扫描 `[chunk_id]` 渲染可点 badge」的成熟范式；实体名可走同款 out-of-band 扫描（按 `kb_mentions` 的 surface_form），**绝不内联标记进文本**。
- **Storybook**：每个新组件枚举 空/加载(Skeleton)/正常/低置信/错误 态（`AGENTS.md` §3 硬要求）。

---

## 4. Phase 2：事件时间线 / 地铁图

> 依赖 Phase 1 的实体（事件的「参与者」= 已识别实体）。出口：一本书的事件按 `time_order` 铺成时间线/地铁图，点站点看详情+跳原文，跨节关系画换乘线。

- **抽取**：按节/按页 LLM 抽事件 → `kb_events`（`name`/`event_type`/`time_raw`/`anchor_chunk_id`/`quote`），参与实体写 `kb_event_participants`。
- **时间三层（防虚假精确，关键纪律）**：
  - `time_raw`：照抄文本里的时间串。
  - `time_norm`：**仅当能从文本确定时才填**（明确写了「1937 年」「第三章」）。
  - `time_order`：叙事顺序号——**即使没有任何绝对时间也能排出一条线**（这是对「类型不限」的关键适配：小说/论文没有公元纪年，但有叙事/逻辑顺序）。
  - `time_source`：`llm_inferred` 的时间**必须在 UI 标注「推断」**，绝不和文本明确时间混同（直接吸取验证阶段对 shiji 纪年的批评——自动推断年份=带权威外观的幻觉）。
- **可视化**：借 shiji `app/metro` 的数据模型（`lines`/`stations`/`transfers`），单书映射：
  - `lines` = 章节/小节（用现有 `list_structure`）。
  - `stations` = 事件（`x_pos` 用 `time_norm` 或回退 `time_order`）。
  - `transfers` = §2.4 的 auto 关系（共现/同事件）。
  - 前端可先做轻量版（SVG 时间轴 + 站点），不必一次还原 shiji 全部地铁美术。
- **落点**：`knowledge/events.rs` + `commands.rs` 加 `get_book_timeline(book_id)` 返回 metro 风格 JSON；前端 `KnowledgePanel` 加「时间线」tab + `BookTimeline.tsx`。

---

## 5. Phase 3：关系网

> 依赖 Phase 1+2。出口：人物/实体关系图谱，点节点看关系+证据跳转。

- **auto 轨先行**（§2.4）：从 `kb_mentions`/`kb_event_participants` 免费算共现/同事件边 → 直接出一张「谁和谁常一起出现」的图，**零额外 LLM 成本**。这已经很有用。
- **llm 轨增强**（可选）：仅对**高频实体对**（auto 边权重 top-N）触发 LLM 判定语义关系（父子/君臣/敌对/因果/引用…），标 `llm`+置信度。控制成本：不全量两两判定。
- **多轮反思**：关系也过一轮一致性自检（如「A 是 B 父亲」与「B 是 A 父亲」冲突检测）。
- **可视化**：`RelationGraph.tsx`（力导向图，节点=实体，边=关系，边粗细=置信度，点边看证据块跳转）。
- **落点**：`knowledge/relations.rs` + `commands.rs::get_book_relation_graph(book_id, min_confidence)`。

---

## 6. Phase 4：「越读越厚」的知识沉淀气质（贯穿，非独立阶段）

这是把前三项缝成「活的知识库」的粘合层，体现 shiji 的精髓——**知识随阅读累积**：

1. **解读收割（harvest）**：每次 `interpret()` 产出解读后，可选地把答案里提到的实体/关系作为**新候选**喂回知识层（`source=llm, status=candidate`，append-only）。挂点：`storage::save_interpretation()`（`1564`）后加可选 `harvest` 步骤，**gate 在开关后**，默认不自动跑（控成本）。
2. **高亮→实体 stub**：用户高亮某段 → 自动建/关联该段涉及的实体（借 wiki stub+lazy-enrich，照 TLDR 惰性模板），高亮即「我在乎这个」的信号，提升相关实体置信度。
3. **纠错即沉淀**：用户每次确认/改名/合并 → `confirmed`，永久保留，后续重抽取绕开（append-only 铁律）。**这就是「越读越准」的机制**——质量随阅读次数单调收敛，正是 shiji 多轮反思的用户侧版本。
4. **知识库健康度**（轻量）：`books` 加 `kb_entity_count` / `kb_confirmed_count` / `kb_source_version` 列，UI 显示「本书已识别 N 个实体，你确认了 M 个」，给「越读越厚」一个可见的进度感。

---

## 7. 明确的边界：现在不做什么（防过度工程）

| 不做 | 理由 |
|---|---|
| **跨书实体/知识图谱** | 现有检索原语全是 `book_id` 作用域，无任何跨书基础设施；自动跨书「同实体合并」会把指代错误当矛盾报出，伤害接地信任。**严格单书**。（你也明确说「每本都是独立精读」，正好一致） |
| **绝对纪年自动推断**（公元前 X 年） | 无权威年表 oracle，自动推断=虚假精确。只做 `time_order` + 文本明确时间；推断时间必标「推断」 |
| **把知识节点升级为引用级证据** | 破坏 `enforce_grounded_citations` 接地保证。知识层只做检索增强+导航 |
| **内联标记进原文**（shiji 的 `〖@〗`） | 破坏 FTS5/offset/选区映射。一律 out-of-band 列存 |
| **RDF/TTL/本体导出** | 通用阅读器无推理消费方；Markdown 导出足够（见下） |
| **强行套 shiji 的 18 类实体/动词四分类/common-sense 规则库** | 全是《史记》单书专用，对任意书无意义。用通用 7 类 |

**可顺带做的低成本增益**（之前方案里验证通过的，可穿插进各 Phase）：
- 解读可信度徽章（透传已算好的 `answer_source`+grounded count）。
- 引用漂移标记（比对 `content_hash`）。
- 知识库一键导出 Markdown（实体表+事件时间线+关系，借 shiji 事件索引版式，单向导出）。

---

## 8. 落地顺序与分工

> 遵循 `AGENTS.md`：文档先行 → 逐阶段 → Storybook 兜底；Codex 写 Rust 抽取/反思/坐标硬骨头，Opus 写前端组件/交互/文档。

| 阶段 | 内容 | 出口标准 | 主负责 |
|---|---|---|---|
| **P1.0 spec 定稿** | 本文对齐 + `docs/knowledge-layer.md` 细化数据模型 | 你确认数据模型与边界 | Opus |
| **P1.1 schema+查询** | 新表 + storage 薄查询 + 迁移测试 | 旧库平滑加表，单测过 | Codex |
| **P1.2 抽取管线** | `knowledge/extract.rs` Step A+B（auto候选+LLM识别）| 一本书跑出实体库（带置信度），缓存进库 | Codex |
| **P1.3 多轮反思** | `knowledge/reflect.rs` 三轮自检 | 低置信噪声显著下降，收敛停止 | Codex |
| **P1.4 实体 UI** | `KnowledgePanel`+`EntityDetailCard`+跳转+纠错 | 点人物→看简介+提及+跳原文+能改 | Opus |
| **P1.5 RAG 集成** | `find_entity` 工具 | 解读时模型能查实体、引用仍接地 | Codex |
| **P2** | 事件 + 时间线/地铁图 | 事件按序成线，点站跳原文 | Codex+Opus |
| **P3** | 关系网（auto 轨先，llm 轨后）| 实体关系图可视化+证据跳转 | Codex+Opus |
| **P4** | 收割/stub/纠错沉淀/健康度 | 「越读越准」可感知 | Codex+Opus |

**建议第一步**：我先把 P1.0 的 `docs/knowledge-layer.md` 写细（数据模型最终定稿 + 抽取/反思 prompt 设计 + 各命令签名），作为 Codex 写 Rust 的对齐基准。

---

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 自动 NER 在任意书上质量参差 | 三轮反思收敛 + 置信度分层 + 用户纠错沉淀；UI 永远标「待确认」，不冒充事实 |
| LLM 抽取成本（整本书） | Step A 零 LLM；B 一次性批量+进度回传;C 只过 candidate；D 按需。全部缓存，重开不重建 |
| 消歧错误（两个「张总」） | LLM 给「合并/拆分/存疑」+理由，存疑不自动合并；用户一键纠正且永久保留 |
| `storage.rs` 已 5890 行 | 知识层独立 `knowledge/` 模块，storage 只加薄查询，守 200–400 行/文件 |
| 破坏现有接地/坐标铁律 | 知识层纯叠加；节点必锚 `chunk_id`；不进 `enforce_grounded_citations`；不碰坐标转换 |
| 时间线对无年份书失效 | `time_order` 叙事序号兜底，绝对时间仅文本明确时填 |

---

## 附：方法与可复核性
- 本方案数据模型与落点基于对当前源码的实读：`storage.rs`（schema `1829-1943`、结构体 `SavedInterpretation 334`/`InterpretationKind 374`/`SearchHit 136`、`TLDR_SOURCE_VERSION 422`、迁移 `ensure_column 1946+`）、`interpretation.rs`（`InterpretMode 57`/`EvidenceItem 93`/工具分发 `1027-1062`/循环常量 `849-850`/`enforce_grounded_citations 1520`）、`llm.rs`（`ToolDefinition 39`/`book_retrieval_tools 113`）、`commands.rs`（`get_or_generate_document_tldr 829`）、`reader-store.ts`（类型定义）。
- 可视化数据模型借 `0_reference/shiji-kb/app/metro`（`lines`/`stations`/`transfers`）。
- 质量路线借 shiji-kb「按章/年代多轮反思」的**过程**，剥离其单书 oracle（`person_lifespans.json`/`reign_periods.json`/`disambiguation_map.json` 均为人工产物，不迁移），代之以通用规则反思 + 用户纠错沉淀。
