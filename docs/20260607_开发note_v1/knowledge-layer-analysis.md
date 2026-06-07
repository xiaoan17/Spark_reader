# 框选精读 借鉴 shiji-kb 的可行技术方案

> 产出日期：2026-06-06
> 方法：并行深读 shiji-kb 4 个子系统 + 框选精读 3 个层（Rust storage / 解读 RAG / 前端 core），再对 34 个「可借鉴点」逐条对照当前真实代码做**怀疑式验证**（验证 agent 实际读了 `storage.rs`/`interpretation.rs`/`llm.rs`/`commands.rs` 并引用了行号）。
> 结论先行：**34 条候选中只有 7 条经得起「通用多 PDF 阅读器、零策展预算」这一硬约束**，其余 27 条（含 shiji-kb 最耀眼的实体索引、纪年推断、5 轮反思、知识图谱）都因依赖人工策展而不可迁移。本方案只写那 7 条，并给出在你现有代码里的确切落点。

---

## 0. 一句话判断：到底能借什么、不能借什么

shiji-kb 和框选精读是**两类不同的产品**：

| 维度 | shiji-kb | 框选精读 |
|---|---|---|
| 对象 | **1 本**已知经典（《史记》130 篇） | **任意**用户 PDF（论文/合同/教材/小说/扫描件） |
| 知识来源 | 人工标注 + Agent 多轮反思 + 权威年表对照 | LLM 一次性自动产出，**无人复核** |
| 策展预算 | 几个月人工 + ~21,442 处实体修正 + ~2,119 处年代修正 + 5 轮反思 | **≈0** |
| 知识形态 | 沉淀为可查询的结构化资产（5MB 实体索引、7637 条关系、2090 条纪年映射） | 目前只有「每次问答的自由文本解读」，**跨会话不积累** |

**这决定了借鉴的边界**：

- ✅ **能借的是「纪律和模式」**——append-only 不覆盖、几何/原文锚定、provenance 分层、惰性补全、auto-vs-LLM 双轨、可导出的 Markdown 知识册。这些都是**与单书无关**的工程纪律。
- ❌ **不能借的是「策展产物」**——实体规范化字典、`disambiguation_map.json`（同一「武王」在不同篇里指周武王/秦武王，**靠人判断**）、纪年推断、common-sense 反常规则库、SKU 知识单元、跨章知识图谱。这些的价值 100% 来自人工策展，自动跑在任意 PDF 上只会产出**带着权威外观的幻觉**，比不做更糟。

> 一句话：**借 shiji-kb 怎么保证质量的「过程纪律」，别借它人工堆出来的「知识结果」。**

下文每条都标注：`[借什么]`、`[落点]`（你代码里的确切位置）、`[工作量]`、`[为什么这条能活下来]`。

---

## 1. 当前框选精读的真实地基（验证过的代码事实）

写方案前先钉死现状，避免凭空发挥：

**SQLite（`library.sqlite3`）现有 10 张表 + 1 张 FTS：**
- `books`：文档元数据；已有 `quality_json`、`tldr_text/tldr_generated_at/tldr_model/tldr_source_version`（UI 摘要，**已是惰性+版本门控**）。
- `pages`：页级 text/markdown。
- `chunks`：块级单元，`chunk_id`(PK) / `book_id` / `page_index` / `text` / `markdown` / **`rects_json`（归一化 0..1 坐标，几何真相）** / `embedding` / `engine` / `coordinate_version`。
- `chunks_fts`：FTS5 全文索引。
- `highlights`：`rects_json` + `position_start/position_end` + `prefix/suffix`（耐久锚点）。
- `interpretations`：解读历史；`evidence_chunk_ids_json` + **`evidence_chunk_snapshots_json`（每条证据带 `content_hash` 审计）** + `kind`。
- `chunk_embeddings`：向量（变维，按 provider/model/dim 存）。

**关键已有能力（很多「想借的」其实已经实现）：**
- `chunk_id.rs::content_hash()`：对块文本做哈希 → 写进 `chunk_id`；`EvidenceChunkSnapshot` 存每条引用的 `content_hash`。**→ 引用漂移检测已天然具备。**
- `interpretation.rs::enforce_grounded_citations()`（行 1520）：解析 `[chunk_id]`、逐条对证据集校验、丢弃非法引用、追加可核验证据脚注。**→ 「机械校验轨」已实现。**
- `AnswerSource {Llm | LocalFallback}`（行 75）：**→ provenance 分层已具备。**
- `InterpretMode {Deep, Plain}`（行 57）、`InterpretationKind {Interpretation, Spark, Note}`（行 374）：**→ 模式/类型扩展位已具备。**
- `get_or_generate_document_tldr()`（`commands.rs:829`）+ `save_book_tldr`/`TLDR_SOURCE_VERSION`：**→ 「惰性生成 + 缓存 + 版本门控 + 不覆盖」模式已实现，可直接复用为模板。**
- 检索原语全部 `book_id` 作用域：`search_book` / `hybrid_search_book` / `get_chunk` / `get_neighbors` / `list_structure`。**→ 没有任何跨书查询函数（这点很重要，见 §5）。**
- **完全没有**：实体/NER/事件/关系/知识图谱代码。`entity_index.json` 在前后端都没有被引用。

---

## 2. 七条能落地的借鉴（按推荐优先级）

### 借鉴 A：解读「应用/迁移」模式 —— 把 SKU 的 Procedural/Eureka 思想收敛成一个按钮
**[借什么]** shiji-kb 把知识分 Factual（事实）/ Procedural（方法，带「现代应用」）/ Eureka（跨域迁移）。**整套自动分类不可借**（对税法 PDF 谈「现代应用」是胡扯，且违反你 `interpretation.rs:1709` 已写死的「避免空泛鸡汤」）。但**「让用户主动要一段『这条原理如何用到今天』」**这个交互是有价值的。
**[落点]**
- `interpretation.rs:57` `InterpretMode` 增一个 `Apply`（或 `Transfer`）变体；
- `build_retrieval_plan`（行 1202-1217）、mode-label（行 1613）、follow-up prompt（行 1729-1732）各加一条 match 臂，prompt 写「将这段原理迁移到现代场景，**必须基于已检索证据 `[chunk_id]`**，1-3 条，禁空泛」；
- 前端 `App.tsx:1325` 解读卡片底部按钮行加一个「应用/迁移」按钮；
- 持久化**零改 schema**——复用 `InterpretationKind`，加一个 `transfer` 字符串变体即可（`storage.rs:400-415` 两行枚举）。
**[工作量]** S（一个枚举 + 一条 prompt 分支 + 一个按钮）。
**[为什么能活]** 复用现有 mode 机制，opt-in、强制证据锚定，绝不自动跑（自动跑就是鸡汤）。把 shiji 的三层 SKU 思想**降维成一个可选模式**，不引入任何新表/NER/分类管线。

---

### 借鉴 B：解读历史一键导出为「Markdown 知识册」—— 借 shiji 事件索引的版式，不借它的内容
**[借什么]** shiji `001_五帝本纪_事件索引.md` 的版式很好用：**顶部总览表**（一行一条：ID / 名称 / 类型 / 时间 / 地点 / 人物）+ **底部详细记录**（描述 / 原文引用 / 段落位置 / 推断理由）。这个「表格速览 + 叙述详情」的双层版式可迁移、可 diff、可归档。**但表格里的策展列（朝代、推断纪年、消歧实体）不可借**——那是 5 轮反思的人工产物。
**[落点]**
- 读取路径已存在：`storage::list_interpretations_page()`（`storage.rs:1659`）返回 `Vec<SavedInterpretation>`，字段齐全（`selection_text` / `session_id` / `page_indexes` / `evidence_chunk_ids` / `question` / `answer` / `kind` / `created_at`）；Tauri 命令 `list_interpretations`（`commands.rs:818`）已暴露。
- 序列化器作为**纯函数**加在 `src/core/interpretation-history.ts`（紧挨已有的 `summarizeInterpretationSessions`，它已按 `sessionId` 分组——正好是详情分节所需），再在 `InterpretationCard.tsx` 加「导出 Markdown」按钮。
- 通用列只取 `页码 / 类型 / 日期 / 选区摘录`；详情节为 `问题 / 解读 / 原文选区引用 / 证据 chunk_id 列表（带页码）`。
**[工作量]** S（只读现有数据，**无新表、无 NER**）。
**[为什么能活]** 严格收敛为**单向导出**（去掉「再导入校验 bbox」那种花活，没有导入解析器）。给用户一个「把我读过/解过的东西导成笔记本」的真实价值，且不碰知识图谱那条不可行的路。

---

### 借鉴 C：解读可信度「徽章」—— 把 shiji 双轨校验里**唯一能迁移的那半**显性化
**[借什么]** shiji 的「快机械校验 + 慢 Agent 语义复核」双轨。**慢轨不可借**（它依赖 `person_lifespans.json`/`reign_periods.json` 这类人工真值表 + 冻结语料 + 逐章累积 SKILL）。**快轨你其实已经实现了**（`enforce_grounded_citations`）——只是结果没给用户看。
**[落点]**
- `enforce_grounded_citations()`（`interpretation.rs:1520`，`interpret()` 行 232 调用）已算出 `valid_count`（`rewrite_chunk_citations` 行 1544）和 `answer_source`；
- 把这两个值作为结构化字段挂到 `InterpretResponse`（行 251-257），经已有的 `InterpretationStreamEvent.answer_source`（行 297）透传到前端 `reader-store.ts::ReaderState.answerSource`；
- `InterpretationCard.tsx`（已有 `error`/`streaming` 态）渲染一个徽章：🟢 全部引用可核验 / 🟡 部分引用被丢弃 / ⚪ 本地降级无 LLM。
**[工作量]** S（透传一个已算好的信号 + 一个徽章，**无新表、无真值表、无第二次 LLM**）。
**[为什么能活]** 只暴露**已经在跑**的接地信号；坚决不建并行复核管线（那会把单书假设偷运进来，且语义「fail」在任意 PDF 上只是第二个 LLM 的无依据意见，绝不能用来阻断用户）。

---

### 借鉴 D：高亮「惰性补全笔记 stub」—— 借 wiki 的 stub+lazy-enrich 架构，不借实体索引
**[借什么]** shiji wiki 的「用户点到谁 → 先建空壳页 → 之后惰性补全 → 不覆盖手写内容」。**实体规范化/wikilink/跨书去重不可借**（那 95% 的价值在 5MB 人工实体索引里，你没有 NER）。但**「惰性补全 + append-only 保护」这个架构你已经在 TLDR 上实现了**。
**[落点]**
- 高亮时建 stub：`storage.rs::save_highlight()`（行 1475）+ `save_interpretation()`（行 1564，`kind` 已支持 `note`）——高亮即创建一条空 body 的 `note`。
- 补全照搬 TLDR 模板：新增 `get_or_generate_highlight_note()`，镜像 `get_or_generate_document_tldr`（`commands.rs:829`）+ `save_book_tldr`/`TLDR_SOURCE_VERSION`（`storage.rs:1754`）——首次打开时填 body，**用 `source_version`/`auto_generated` 门控，绝不覆盖用户手改**（shiji `CLAUDE.md` 记录过多次「覆盖手写内容」的血泪数据丢失，这条纪律是硬要求）。
- 「在出现处之间跳转」复用 `ReaderShell.tsx::onCitationClick` 的 chunkId 跳转 + 子串/模糊匹配（**只是子串匹配，不许冒充实体消解**）。
**[工作量]** M。
**[为什么能活]** 砍掉实体层，只保留「惰性补全 + 不覆盖」这套你已验证过的架构；补全必须 `auto_generated` 标记 + 用户显式触发（像 TLDR 的 `/regenerate` 按钮），不在高亮时静默烧钱。

---

### 借鉴 E：append-only 写入纪律（工程铁律，跨整个知识层）
**[借什么]** shiji `CLAUDE.md` 第 3 条「严禁替换已有内容（Append-Only）」：目标节/字段不存在→可新建；为空→可填；**已存在→必须跳过，绝不覆盖**。去重/合并是后续工序，宁留重复也不因「更新」丢内容。
**[落点]** 凡是后续给知识层（笔记 stub、导出、未来任何派生数据）写入的代码路径，都遵循「version-gated upsert，不 clobber」。你现有的 `TLDR_SOURCE_VERSION` 门控就是这条纪律的样板，把它作为**所有派生写入的统一约定**写进 `AGENTS.md` 铁律表。
**[工作量]** S（一条写进 `AGENTS.md` 的约定 + code review 检查项）。
**[为什么能活]** 这是**与单书无关的纯工程纪律**，且你已有先例（TLDR）。它的价值在 D 落地后立刻兑现：保护用户手改的笔记不被自动补全冲掉。

---

### 借鉴 F：原文锚定 + provenance 分层的「显性化」纪律
**[借什么]** shiji 把每条事件都带「原文引用 + 段落位置 + 推断理由」三件套，让任何派生知识都能回溯到原文。**纪年推断那层不可借**，但「派生物必须可回溯到原文几何位置」这条纪律可借——而且**你已经做得比 shiji 更严**（chunk_id + rects + content_hash）。
**[落点]** 不需要新建「段落位置」字段——你的 `evidence_chunk_ids_json` + `evidence_chunk_snapshots_json`（含 `content_hash`）+ `chunks.rects_json` 已经 1:1 覆盖了 shiji 的「原文引用 + 段落位置」。**唯一值得加的微功能**：加载解读时用一个 helper 比对 `snapshot.content_hash` vs 当前 chunk 的 `content_hash`（复用 `chunk_id.rs::content_hash`），不一致就把该引用标为「原文已变动」。
**[工作量]** S（一个比对函数 + UI 标记）。
**[为什么能活]** 解决「我引用的原文在重解析后变了吗」这个真问题，复用现成哈希，无需重建 shiji 那种「strip-markers==原文」的不可实现机制（你根本没有内联标记，也没有按坐标回抽文本的路径）。

---

### 借鉴 G（仅作 V2 探索，不进近期排期）：单 PDF 内的实体「检索增强叠加层」
**[借什么]** shiji 的双视角图：篇内「线」（顺序）vs 跨篇「换乘」（同实体/共人/共地/同年）。**跨文档那半坚决砍掉**（见 §5）。**篇内**这半可对应到：`get_neighbors`=线，「同名提及跨块」=换乘。
**[落点]**（若未来真要做）单 PDF 作用域：`llm.rs::book_retrieval_tools()`（行 113-120）加一个 `find_mentions` 工具；`interpretation.rs::execute_retrieval_tool_call()`（行 1027-1062）加 match 臂，返回 `Vec<SearchHit>`，**让现有 `rank_evidence` + `enforce_grounded_citations` 完全不变**。实体只做**检索增强叠加**，**绝不**升级为引用级证据（它没有 rects 接地，升级会破坏你产品赖以立身的接地保证）。
**[工作量]** L–XL。
**[为什么先不做]** 自动 NER 在任意 PDF 上的质量是成败关键，而你没有策展预算去修；它和更高价值的工作（A–F）抢资源。**结论：标记为 V2 探索，不进近期排期。**

---

## 3. 推荐落地顺序（与你 ROADMAP 的阶段风格对齐）

> 全部走你 `AGENTS.md` 的「文档先行 → 逐阶段 → Storybook 兜底」，且 Codex 写 Rust/RAG、Opus 写前端/文档的分工不变。

**第一批（建议先做，全是 S，1 周内，立即提升体验且零架构风险）：**
1. **借鉴 C 可信度徽章** —— 把已算好的接地信号给用户看，性价比最高。
2. **借鉴 F content_hash 漂移标记** —— 复用现成哈希，补上「引用是否过时」。
3. **借鉴 E append-only 铁律** —— 写进 `AGENTS.md`，为后续写入兜底。
4. **借鉴 B Markdown 知识册导出** —— 只读导出，用户感知强。

**第二批（A 模式 + D 笔记 stub，1–2 周）：**
5. **借鉴 A「应用/迁移」模式** —— 一个枚举 + prompt 分支 + 按钮。
6. **借鉴 D 高亮惰性补全笔记** —— 复用 TLDR 模板，是「跨会话知识积累」的第一块真砖。

**第三批（V2，不排期）：**
7. **借鉴 G 单 PDF 实体叠加层** —— 等前面验证用户确实想要「跨会话知识」后再评估。

---

## 4. 反过来：shiji-kb 有什么能力是你**现在就该停手别学**的

把这些明确写下来，防止后续被「看起来很厉害」带偏：

| shiji-kb 的能力 | 为什么不要学（验证过的硬理由） |
|---|---|
| 实体规范化字典 / `disambiguation_map.json` | 同一「武王」按篇指周/秦武王，**靠人判断**；任意 PDF 没有这个 oracle，自动消歧大面积出错 |
| 纪年推断管线（`year_ce_map.json` 2090 条） | 来自人工年表 + 扫描版权威书 `[中国历史大事年表].沈起炜`；任意 PDF 无对照表，自动「推断年份」=幻觉数字配真原文，**制造虚假精确** |
| 18 类 Unicode 内联标注（`〖@〗`/`⟦◈⟧`） | 内联标记一旦进 `chunk.text` 就破坏 FTS5、byte-offset 高亮、选区→块映射；你的 out-of-band 列存方案更优 |
| `strip-markers==原文` 完整性 lint | 你没有内联标记可校验，也没有「按坐标回抽 PDF 文本」的路径，会在 OCR/连字/CJK 归一化上**持续误报** |
| common-sense 反常规则库（134 条） | 是《史记》统治叙事专用 oracle，对论文/合同/小说无意义 |
| 5 轮 Agent 反思 + 累积 SKILL | 依赖冻结语料 + 逐条人工复核；任意 PDF 一次性看过、不重解析，反思无处累积 |
| 跨章/跨书知识图谱 + 冲突检测 | 你**没有任何跨书查询基础设施**（所有检索原语都是 `book_id` 作用域）；自动跨文档「同实体合并」会把指代错误当「矛盾」报出来，**直接伤害你的接地式引用信任** |
| RDF/TTL 三格式导出 | 通用阅读器没有推理消费方；Markdown 导出（借鉴 B）足够 |

---

## 5. 一个贯穿始终的判断原则（给后续所有 agent）

> **凡是 shiji-kb 的某个能力，其质量依赖「人工策展 / 权威对照表 / 多轮人工反思 / 冻结单书语料」，就不能搬到框选精读**——因为框选精读面对的是「任意用户 PDF、看一次、零策展预算」。
>
> **能搬的永远是「过程纪律」而非「策展结果」**：append-only 不覆盖、几何/原文锚定、provenance 分层显性化、惰性补全 + 版本门控、auto-vs-LLM 分轨、单向 Markdown 导出。
>
> 任何想引入「实体表 / NER / 跨书图谱 / 自动纪年」的提议，先问一句：**这本随手拖进来的 PDF，谁来当那个判断「武王=周武王还是秦武王」的人？** 没有答案，就不做。

---

## 附：本方案的产出方法（可复核）

- 并行深读 shiji-kb：`kg/`（实体/事件/关系/家谱/纪年）、`ontology/taxonomy/common-sense`、`wiki/server+scripts` 反思管线、`corpus` 标注体系 + `app/metro` 可视化。
- 并行深读框选精读：`src-tauri/src/`（storage/interpretation/llm/commands，含确切行号）、`src/core` + `src/components`、`docs/architecture.md`/`tech-stack.md`、`AGENTS.md`/`ROADMAP.md`。
- 对 34 条候选逐条「怀疑式验证」：每条都对照当前真实代码判断 feasible / effort / 落点 / 风险，默认对「过度工程」保持怀疑。**34 → 7** 的收敛比例本身就是结论：shiji-kb 真正可借的是少数工程纪律，多数耀眼能力是单书人工策展的产物。
