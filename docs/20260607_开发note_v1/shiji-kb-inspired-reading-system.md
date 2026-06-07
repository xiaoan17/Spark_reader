# 借鉴 shiji-kb 的阅读体系与查阅体验技术方案

> 产出日期：2026-06-06
> 参考项目：`0_reference/shiji-kb`
> 目标：把当前「框选精读」从一次性解读工具，演进成每本书可持续沉淀、可检索、可跳转、可导出的单书阅读知识体系。

---

## 1. 结论先行

shiji-kb 最值得借鉴的不是《史记》专用的实体词典、纪年表、消歧规则，也不是一次性搬它的知识图谱。那些能力的质量来自长期人工策展和多轮反思，直接套到任意 PDF 上会产生带权威外观的幻觉。

真正适合当前产品的是这些工程模式：

1. **所有派生知识都必须回到原文位置**：shiji-kb 用原文引文和段落号，我们已有更强的 `chunk_id + rects_json + content_hash`。
2. **读过的内容要沉淀成可查资产**：高亮、解读、追问、笔记不只留在历史列表里，而是形成单书知识册。
3. **导航视图比“大而全知识图谱”更先有价值**：shiji 地铁图的 `lines / stations / transfers` 模型可迁移为章节线、知识节点、关联边。
4. **append-only + provenance 是底线**：自动生成只补空缺，绝不覆盖用户手写或已确认内容。
5. **auto 轨与 LLM 轨分开**：确定的共现/引用/邻近关系自动算；需要语义判断的关系才交给 LLM，并带置信度和状态。
6. **可导出的知识册**：shiji 事件索引的「概览表 + 详情记录 + 原文引用」版式非常适合我们的阅读成果导出。

因此推荐路线是：

**先做阅读成果沉淀层，再做可选的实体/事件/关系抽取层。**

---

## 2. 当前项目可复用的地基

现有架构已经具备知识层所需的关键能力，不需要推倒重来：

| 能力 | 现状 | 知识层用法 |
|---|---|---|
| 稳定原文锚点 | `chunks.chunk_id`、`rects_json`、`coordinate_version` | 所有知识卡片证据都引用 `chunk_id`，点击跳回原文 |
| 引用接地校验 | `interpretation.rs` 的 `[chunk_id]` 后处理和校验 | 知识层只做检索增强，不替代引用证据 |
| 解读历史 | `interpretations` 表保存 selection、answer、evidence snapshots | 作为知识册导出的第一批素材 |
| 高亮 | `highlights` 表保存 selection、prefix/suffix、rects | 作为用户显式关注信号，生成笔记 stub |
| 惰性生成 | `get_or_generate_document_tldr` + `TLDR_SOURCE_VERSION` | 复用为高亮笔记、实体简介、章节摘要的生成模板 |
| 单书检索 | `search_book/get_chunk/get_neighbors/list_structure` | 新知识工具仍限定 `book_id`，不做跨书 |
| 本地 SQLite | 已承载书、页、块、FTS、向量、历史 | 新知识表增量迁移即可 |

关键约束也不变：

- 原文和 `chunks.text` 不内联标注，不污染 FTS 和选区映射。
- 引用仍统一走 `[chunk_id]`，不依赖任何厂商 citation。
- 所有知识节点必须能回到原文 chunk；没有原文证据的内容只能是用户笔记，不能进入证据链。
- 密钥仍只在 Rust 后端。

---

## 3. 不建议迁移的 shiji-kb 能力

| shiji-kb 能力 | 不直接迁移的原因 | 替代方案 |
|---|---|---|
| 18 类实体标注和内联符号 | 强依赖《史记》语料；内联标记会破坏原文与 offset | out-of-band 知识表，通用类型 |
| `entity_aliases` / `disambiguation_map` | 依赖人工判断，同名消歧不可自动信任 | 候选状态 + 用户确认/合并 |
| 公元纪年推断 | 需要权威年表 oracle，任意 PDF 不具备 | 保留 `time_raw`，只在明确时写 `time_norm`，否则用阅读顺序 |
| 跨章/跨书冲突检测 | 当前检索严格单书；自动跨书同实体合并风险高 | 先做单书知识体系 |
| common-sense 规则库 | 《史记》专用历史常识 | 不迁移；未来按书/领域 opt-in |
| RDF/TTL 多格式导出 | 当前没有推理消费方 | 先做 Markdown/JSON 导出 |
| Butler 大规模 autonomous wiki | 成本高、质量依赖长期维护 | 做用户触发的轻量沉淀和纠错 |

---

## 4. 目标形态

每本书有一个本地、独立的「阅读知识层」，附着在原书之上：

```text
PDF / TXT / Markdown 原文
  └─ chunks（唯一证据单元，带 rects）
      ├─ highlights（用户关注）
      ├─ interpretations（AI 解读）
      └─ kb_cards（知识卡片：笔记 / 概念 / 事件 / 人物 / 论点）
           ├─ kb_evidence（每张卡片引用哪些 chunk）
           └─ kb_edges（卡片之间的关联、反链、共现、因果候选）
```

前端阅读器新增一个可折叠的「知识」面板：

- **笔记**：高亮、解读、追问、用户补充，按章节聚合。
- **索引**：人物/概念/术语/作品等候选，低置信项明确标注。
- **地图**：借 shiji 地铁图模型，把章节/小节作为线路，把事件/论点/概念出现作为站点。
- **关联**：自动反链、共现边、用户确认的关系。
- **导出**：一键导出 Markdown 知识册。

知识面板里的每个项目都必须有「证据」区：显示摘录、页码、chunk_id，点击跳回原文高亮。

---

## 5. 数据模型建议

第一版不要把实体、事件、关系都拆成复杂专表。建议先上一个通用知识卡片模型，后续再按需要加实体/事件细表。

### 5.1 `kb_cards`

```sql
CREATE TABLE IF NOT EXISTS kb_cards (
  card_id        TEXT PRIMARY KEY,
  book_id        TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  card_type      TEXT NOT NULL, -- note|concept|entity|event|claim|question|summary
  title          TEXT NOT NULL,
  summary        TEXT,
  body_markdown  TEXT,
  payload_json   TEXT NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'candidate', -- candidate|confirmed|rejected
  source         TEXT NOT NULL DEFAULT 'user',      -- user|highlight|interpretation|auto|llm
  confidence     REAL NOT NULL DEFAULT 1.0,
  source_version INTEGER NOT NULL DEFAULT 1,
  user_locked    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kb_cards_book_type
  ON kb_cards(book_id, card_type, status, updated_at DESC);
```

`payload_json` 用于承载不同卡片的扩展字段：

- `event`: `time_raw`、`time_norm`、`time_order`、`time_source`、`people`、`places`
- `entity`: `entity_type`、`aliases`
- `claim`: `claim_type`、`section_id`
- `note`: `highlight_id`、`interpretation_id`

### 5.2 `kb_evidence`

```sql
CREATE TABLE IF NOT EXISTS kb_evidence (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id     TEXT NOT NULL REFERENCES kb_cards(card_id) ON DELETE CASCADE,
  book_id     TEXT NOT NULL,
  chunk_id    TEXT NOT NULL,
  page_index  INTEGER,
  quote       TEXT,
  role        TEXT NOT NULL DEFAULT 'support', -- support|context|counterpoint|source
  created_at  TEXT NOT NULL,
  FOREIGN KEY(book_id, chunk_id) REFERENCES chunks(book_id, chunk_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kb_evidence_card ON kb_evidence(card_id);
CREATE INDEX IF NOT EXISTS idx_kb_evidence_chunk ON kb_evidence(book_id, chunk_id);
```

### 5.3 `kb_edges`

```sql
CREATE TABLE IF NOT EXISTS kb_edges (
  edge_id       TEXT PRIMARY KEY,
  book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_card_id TEXT NOT NULL REFERENCES kb_cards(card_id) ON DELETE CASCADE,
  target_card_id TEXT NOT NULL REFERENCES kb_cards(card_id) ON DELETE CASCADE,
  edge_type     TEXT NOT NULL, -- backlink|co_evidence|co_mention|sequel|causal|contrast|supports
  label         TEXT,
  evidence_chunk_ids_json TEXT NOT NULL DEFAULT '[]',
  source        TEXT NOT NULL DEFAULT 'auto',
  confidence    REAL NOT NULL DEFAULT 1.0,
  status        TEXT NOT NULL DEFAULT 'candidate',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kb_edges_book_source
  ON kb_edges(book_id, source_card_id);
```

### 5.4 append-only 规则

所有自动写入必须遵守：

- 目标 card 不存在：可新建。
- 目标字段为空：可填。
- `user_locked = 1` 或 `status = confirmed`：自动流程不得覆盖。
- 用户编辑过的 `body_markdown`、`summary` 永不被自动重写。
- 重新抽取只补充新 card / 新 evidence / 新 edge。

---

## 6. 分阶段落地

### Phase 0：低风险体验增强（先做）

目标：不用新知识抽取，也能让用户立刻感到「读过的东西开始沉淀」。

1. **解读可信度徽章**
   - 透传已有引用校验结果：全部引用可核验 / 部分引用被丢弃 / 本地降级。
   - UI 放在 `InterpretationCard` 标题区。

2. **引用漂移提示**
   - 加载历史解读时，比对 `evidence_chunk_snapshots_json.content_hash` 和当前 chunk hash。
   - 不一致时标注「原文已重解析，引用需复核」。

3. **Markdown 知识册导出**
   - 从 `interpretations`、`highlights` 读取，不做 LLM。
   - 版式借 shiji 事件索引：顶部总览表，下面详情记录。
   - 每条详情含：选区、问题、答案、证据 chunk、页码。

4. **高亮笔记 stub**
   - 用户保存高亮时生成一张 `kb_cards(card_type='note')`。
   - 首次打开可手动触发「补全笔记」，复用 TLDR 惰性生成模式。

5. **应用/迁移解读模式**
   - 在现有 `Deep / Plain` 外增加一个 opt-in 模式。
   - Prompt 要求所有迁移判断仍基于 `[chunk_id]` 证据，避免泛泛鸡汤。

出口标准：

- 不调用新抽取流程也能导出一本书的阅读知识册。
- 所有导出条目都能点击或追溯到原文 chunk。
- 用户手写笔记不会被自动生成覆盖。

### Phase 1：知识卡片层

目标：把高亮、解读、用户笔记统一沉淀为可查卡片。

后端：

- 新增 `src-tauri/src/knowledge/`：
  - `cards.rs`：增删改查、append-only upsert。
  - `evidence.rs`：证据绑定和跳转数据。
  - `export.rs`：Markdown/JSON 导出。
  - `query.rs`：按标题、正文、证据 chunk 搜索知识卡片。
- `storage.rs` 只保留薄查询函数，避免继续膨胀。
- Tauri commands：
  - `list_kb_cards(book_id, filter)`
  - `get_kb_card(card_id)`
  - `upsert_kb_card(request)`
  - `reject_kb_card(card_id)`
  - `confirm_kb_card(card_id)`
  - `export_book_knowledge_markdown(book_id)`

前端：

- 新增 `src/components/knowledge/KnowledgePanel.tsx`
- 新增 `KnowledgeCardList`、`KnowledgeCardDetail`、`KnowledgeExportDialog`
- `reader-store.ts` 增加 knowledge slice。
- Storybook 覆盖空、加载、错误、低置信、已确认、用户锁定状态。

出口标准：

- 高亮、解读、用户笔记能在知识面板统一查阅。
- 卡片详情能显示证据并跳回原文。
- Markdown 导出稳定可读。

### Phase 2：章节地图 / 时间线

目标：借 shiji 地铁图的数据模型，做单书导航视图，而不是一上来做完整图谱。

数据模型：

```ts
type BookKnowledgeMap = {
  lines: Array<{
    id: string
    name: string
    group: string
    stations: KnowledgeStation[]
  }>
  transfers: Array<{
    sourceStationId: string
    targetStationId: string
    type: "same_evidence" | "shared_card" | "co_mention" | "user_link"
    weight: number
    evidenceChunkIds: string[]
  }>
}
```

映射规则：

- `lines` = 章节 / 小节 / 目录结构。
- `stations` = 事件、概念、论点、关键笔记。
- `x_pos` 优先用 `time_norm`；没有绝对时间时用 `time_order` 或 chunk 顺序。
- `transfers` 先只做自动边：共证据、同 chunk、相邻 chunk、用户手动链接。

事件抽取策略：

- 先按章节/小节、用户触发生成，不在导入时全书静默跑。
- `time_raw` 只记录原文明确出现的时间字符串。
- `time_norm` 只有文本明确可确定时才写。
- LLM 推断时间必须写 `time_source='llm_inferred'`，UI 标注「推断」。

出口标准：

- 一本文档能生成「章节线 + 关键站点」的地图。
- 点击站点能看到摘要、证据、原文跳转。
- 没有时间信息的小说/论文/教材也能按阅读顺序展示。

### Phase 3：实体/概念索引（可选增强）

目标：做单书内的实体/概念辅助检索，不把它变成权威知识图谱。

抽取来源优先级：

1. 用户高亮和笔记标题。
2. 解读答案里已经带证据的概念。
3. FTS 高频词和标题/书名号候选。
4. LLM 批量识别和合并建议。

规则：

- 全部默认 `candidate`。
- 只在用户确认后变 `confirmed`。
- 合并/改名必须 append-only 保留原始别名。
- 低置信实体不在正文里大面积高亮，避免干扰阅读。

RAG 集成：

- 增加 `search_knowledge` 工具，而不是只做 `find_entity`。
- 工具返回知识卡片及其证据 chunks。
- 最终回答引用仍只允许 `[chunk_id]`。

出口标准：

- 用户搜索某个人名/术语，能看到「简介 + 出现位置 + 相关解读」。
- AI 解读能调用知识层找到相关 chunk，但引用仍可被现有机制校验。

### Phase 4：关系和反链

目标：做可解释的轻量关系网。

先做 auto 轨：

- 两张卡片引用同一 chunk：`same_evidence`
- 两张卡片经常出现在相邻 chunk：`nearby`
- 一张卡片正文链接另一张：`backlink`
- 用户手动建立关系：`user_link`

再做 LLM 轨：

- 只对高频、高置信、用户关注的卡片对做关系判断。
- 类型限定：`supports`、`contrasts`、`causes`、`sequel`、`part_of`。
- 每条 LLM 边必须有 evidence chunk，且默认 `candidate`。

出口标准：

- 卡片详情能显示「引用了它的卡片」和「相关卡片」。
- 图视图只作为导航，不作为事实判定。

---

## 7. 与现有 RAG 的集成方式

知识层不能绕过现有接地机制。推荐新增一个工具：

```text
search_knowledge(query, card_type?, limit?)
```

执行逻辑：

1. 在 `kb_cards` 和 `kb_evidence` 中检索相关卡片。
2. 把卡片绑定的 evidence chunks 转成现有 `SearchHit` 风格结果。
3. 交给现有 `rank_evidence`、`enforce_grounded_citations`。
4. LLM 最终仍只能引用 `[chunk_id]`。

这样知识层的角色是：

- 帮模型更快找到「读者已经沉淀过的相关内容」。
- 不替模型背书。
- 不改变引用协议。

---

## 8. UI 方案

### 阅读器布局

在现有阅读器右侧增加可折叠知识面板，不改变主阅读流：

```text
左：书架/目录（可折叠）
中：阅读区
右：解读卡片
最右：知识面板（可折叠）
```

移动端或窄屏时，知识面板作为底部抽屉或 tab，不散布 `isMobile()` 到核心组件。

### 知识面板 Tabs

1. **笔记**
   - 高亮笔记、解读、追问。
   - 按章节和更新时间排序。

2. **索引**
   - 概念/人物/术语候选。
   - `candidate`、`confirmed`、`rejected` 明确分层。

3. **地图**
   - 章节线 + 站点。
   - 站点点击打开卡片详情。

4. **关联**
   - 反链和相关卡片列表。
   - 图视图放到 V2，第一版用列表更稳。

### 卡片详情

每张卡片固定显示：

- 标题、类型、状态、来源、置信度。
- 摘要或正文。
- 证据列表：页码、摘录、chunk_id、跳转按钮。
- 操作：确认、编辑、拒绝、链接到其他卡片、导出。

UI 文案要避免把自动内容包装成事实：

- `AI 候选`
- `用户确认`
- `基于高亮生成`
- `推断时间`
- `引用需复核`

---

## 9. 验证与测试

后端测试：

- 旧库打开后自动建表，不破坏现有数据。
- append-only upsert 不覆盖 `user_locked` 和 `confirmed`。
- 删除书后级联删除知识卡片和证据。
- `kb_evidence` 的 chunk 外键有效。
- `search_knowledge` 只返回当前 `book_id` 的证据。
- Markdown 导出在空书、只有高亮、只有解读、多轮追问下均稳定。

前端测试：

- `KnowledgePanel` 空/加载/错误/正常状态。
- 卡片点击证据能复用现有 citation jump。
- 低置信候选不会显示成已确认。
- 用户编辑后不会被刷新覆盖。
- 导出按钮在浏览器预览和 Tauri 桌面端有明确能力差异。

产品自检：

- 扩展 `product_self_check`，加入：
  - 保存高亮生成 note card。
  - 保存解读绑定 evidence。
  - 导出 Markdown 包含证据 chunk。
  - 重新打开后知识卡片仍可跳转。

---

## 10. 推荐排期

| 阶段 | 时间 | 主要收益 |
|---|---:|---|
| Phase 0 | 3-5 天 | 可信度、导出、笔记 stub，立即改善查阅体验 |
| Phase 1 | 1-2 周 | 形成统一知识卡片层 |
| Phase 2 | 1-2 周 | 单书章节地图/时间线，建立长期导航入口 |
| Phase 3 | 2-3 周 | 可选实体/概念索引，增强检索 |
| Phase 4 | 1-2 周 | 反链和轻量关系网 |

建议先实施 Phase 0 + Phase 1。它们完全依赖现有高亮、解读和 chunk 证据，风险最低，也最符合「为了以后查阅体验」这个目标。

---

## 11. 第一批具体实现任务

1. 新增 `docs` 规则：自动派生知识 append-only，不覆盖用户内容。
2. Rust 新增 `knowledge` 模块和三张表：`kb_cards`、`kb_evidence`、`kb_edges`。
3. 保存高亮时创建 `note` card，并绑定 highlight/chunk evidence。
4. 保存解读时创建或关联 `question/summary` card，并绑定 evidence chunks。
5. 新增 Markdown 导出纯函数和 Tauri command。
6. 前端新增 `KnowledgePanel` 第一版，只做「笔记 + 导出」。
7. 解读卡片显示引用可信度和引用漂移。
8. 产品自检覆盖知识卡片创建、导出和跳转。

这批任务完成后，产品就具备一个最小闭环：

```text
读书 → 高亮/解读 → 自动沉淀为卡片 → 以后可查 → 可跳回原文 → 可导出
```

这就是从 shiji-kb 借来的核心价值，但实现上严格贴合当前框选精读的技术地基。
