# 翻译与 Spark 回答实现原理

> 面向后来接手本项目的开发者。本文只描述当前真实代码路径，不描述尚未接入生产链路的设想。

## 0. 先记住的结论

翻译和 Spark 回答共用同一本书的转换稿、chunk、LLM provider，但它们不是同一条管线。

| 能力 | 当前定位 | 证据真相 | 主要后端 | 主要缓存 |
|---|---|---|---|---|
| 对照翻译 | 阅读辅助：把原文页逐页译成中文，并与原文块对齐 | 原文仍是真相，译文不是最终引用证据 | `src-tauri/src/translation.rs` | SQLite `page_translations` |
| Spark / 解读 / 追问 | 框选原文后，围绕选区检索全书证据并回答 | `chunk_id + rects_json + content_hash` | `src-tauri/src/interpretation.rs` | SQLite `interpretations` |

最重要的不变量：

- 原文 chunk 是证据源。译文只用于帮助阅读和选择，不升级为引用证据。
- Spark 的最终引用统一使用 `[chunk_id]`，不依赖任何厂商原生 citations。
- 翻译、LLM、embedding key 都只在 Rust 后端读取，不能进前端 bundle。
- 当前对照翻译不走 OpenCode。`docs/[todo]20260602_opencode-agent.md` 已明确：生产路径归 Rust 翻译管线所有。

## 1. 共享前提：书必须先被转换和索引

两条管线都建立在“书已经导入并有转换稿”的前提上：

1. PDF / 文本导入后写入本机 SQLite。
2. 解析页内容、Markdown、chunk、页码、坐标、FTS 索引。
3. 若配置 embedding provider，再补建外部向量索引；没配置时仍可用 FTS。
4. 前端通过 Tauri command 读取转换稿窗口、chunk、目录和搜索结果。

关键文件：

- `src-tauri/src/storage/mod.rs`：books / pages / chunks / FTS / interpretations 等 SQLite 主数据。
- `src-tauri/src/commands.rs`：前端 IPC 的统一入口。
- `src/core/library-api.ts`：前端对 Tauri command 的 typed wrapper。
- `src/components/reader/ReaderShell.tsx`：阅读器编排层。

## 2. 对照翻译的实现原理

### 2.1 它做什么

对照翻译是“整本书后台逐页翻译”。它不是用户框选一句就实时翻译一句，而是：

1. 前端请求启动翻译任务。
2. Rust 后端按页读取转换稿。
3. 每页把 Markdown 切成稳定块，并给每块加 `[[B001]]`、`[[B002]]` 这类编号。
4. 调用当前 LLM provider 翻译。
5. 把每页译文、状态、错误、provider、model 写入 `page_translations`。
6. 前端轮询状态，并把译文按块挂回原文旁边。

设计重点不是“翻得多快”，而是“译文能和原文块稳定对齐”。因此 prompt 强制模型保留块编号，不能合并、拆分、重排或跳过块。

### 2.2 前端启动路径

```text
用户打开/启动“对照翻译”
  -> src/components/reader/ReaderShell.tsx
  -> useReaderTranslation.handleStartTranslation()
  -> src/core/library-api.ts startTranslation(bookId, force)
  -> Tauri invoke("start_translation")
  -> src-tauri/src/commands.rs start_translation()
  -> tauri::async_runtime::spawn(...)
  -> src-tauri/src/translation.rs start_translation()
```

前端 hook：`src/components/reader/use-reader-translation.ts`

- 书籍切换时自动读取 `translation_status`。
- 只有在 Tauri 桌面端才允许整本翻译；浏览器预览会提示需要桌面版和 LLM provider。
- 翻译视图打开时每 2.5 秒轮询一次 `translation_status`。
- `force=true` 时会切到翻译视图并强制重翻已有页。

### 2.3 后端翻译任务

核心入口：`src-tauri/src/translation.rs`

关键步骤：

1. `start_translation()`
   - 初始化 `page_translations` schema。
   - 用 `ACTIVE_TRANSLATIONS` 防止同一本书重复启动多个翻译任务。
   - 注册取消 token。

2. `run_translation_job()`
   - `storage::get_converted_book_manifest()` 读取书的页数和来源信息。
   - `config::llm_config()` 读取当前 LLM provider / model。
   - `translation_source_fingerprint()` 生成缓存指纹。
   - 按 `storage::MAX_CONVERTED_BOOK_PAGE_WINDOW` 分批读取页源。

3. 每页处理：
   - `translation_source_markdown()` 优先取页 Markdown，去掉 `# Page N` 这类页标题；如果 Markdown 空，再用清洗后的 plain text。
   - `marked_translation_source()` 把页 Markdown 切块并编号为 `[[B001]]`。
   - `build_translation_messages()` 拼系统 prompt 和用户 prompt。
   - `llm::chat(messages, translation_max_tokens(...))` 调当前 provider。
   - 成功写 `status=done`；失败写 `status=failed` 并保留错误。

4. 缓存主键：

```text
book_id + page_index + source_fingerprint + provider + model
```

`source_fingerprint` 包含 `TRANSLATION_PROTOCOL_VERSION`。所以翻译协议升级后，旧缓存自然失效，不会把旧格式译文当成新格式使用。

### 2.4 翻译 prompt 的关键约束

系统 prompt 常量：`TRANSLATION_SYSTEM_PROMPT`

核心要求：

- 使用类似 `baoyu-translate normal` 的工作方式：先理解领域、结构、术语、读者，再输出译文。
- 中文要自然准确，保持学术风格。
- Markdown 标题、列表、表格、图片、公式、脚注等尽量保真。
- 必须保留输入块编号。
- 不输出“以下是中文译文”、译者说明、总结、前言。

用户 prompt 进一步强调：

- 输入已经按 `[[B001]]` 编号。
- 每个输入块必须有对应输出块。
- 不要合并、拆分、重排或跳过块。
- 只输出中文译文 Markdown 和块编号。

### 2.5 前端渲染与对齐

核心文件：

- `src/components/reader/TranslationReader.tsx`
- `src/components/reader/translation-alignment.ts`
- `docs/ui/[finish]20260609_translation-alignment.md`

渲染原则：

- 原文布局是视觉真相。
- 译文不参与原文排版，只挂载到原文块旁边。
- 宽屏使用 rail 布局：左侧原文，右侧译文块按原文块测量位置绝对定位。
- 窄屏使用 inline 布局：原文块下方显示对应译文。

对齐函数：

- `alignedTranslationRows(sourceMarkdown, translatedMarkdown)`
  - 优先解析 `[[B001]]` 编号。
  - 用编号把译文块映射回同页原文块。
  - 如果模型没保留编号，才退回“按 Markdown 段落顺序对齐”的弱兜底。

- `sanitizeDisplayedTranslationMarkdown(...)`
  - 去掉代码围栏。
  - 去掉“以下是中文翻译”等样板话。
  - 去掉译者说明块。
  - 尽量过滤模型重复输出的英文原文。

### 2.6 译文选区如何触发 Spark

这是一个关键细节：用户可以在中文译文 rail 里框选，但 Spark 不能把中文译文当作最终证据。

路径在 `TranslationReader.tsx`：

1. `handlePointerUp()` 捕获 DOM selection。
2. `selectionPaneForPageSelection()` 判断选区来自 source 还是 translation pane。
3. 如果来自 translation pane：
   - `translationBlockIdForSelection()` 先找当前译文块的 `B###`。
   - 找到对应原文 row 后，把选区替换成原文块文本。
   - `sourceBlockAnchor()` 用原文页文本生成 `TextQuoteSelector` 位置锚点。
4. 传给上层的仍是原文 text + 原文 anchor。

因此，在对照翻译视图里选中文句，Spark 实际上仍围绕对应英文原文块运行。

### 2.7 翻译当前不走 OpenCode

`docs/[todo]20260602_opencode-agent.md` 已写清楚边界：

- 当前产品路径：前端调用 `start_translation`，Rust 翻译转换稿页，结果写入 SQLite。
- `OpencodeAgentTaskRunner` 还是实验/骨架，不拥有翻译缓存，也不能产出阅读器需要的页级对齐译文。
- 如果未来接 `baoyu-translate` skill，也必须把输出解析回页/块单位，再写入 `page_translations`，不能让前端按钮直接连到 mock runner。

## 3. Spark / 解读 / 追问的实现原理

### 3.1 它做什么

Spark 回答是“选区驱动的 agentic RAG”。用户不是先问一个全局问题，而是先框选原文。后端始终把这段框选文本当作不可漂移的焦点，再围绕它检索全书证据并合成回答。

当前有几类回答模式：

| 模式 | 请求字段 | 说明 |
|---|---|---|
| 深度解读 | `mode=deep`, `lightweight=false` | 完整 agentic 检索，持久化时通常是 `kind=interpretation` |
| 直白解释 / 轻量 Spark | `mode=plain`, `lightweight=true` | 更短路径，优先复用当前选区和已有证据，持久化时通常是 `kind=spark` |
| 追问 | 带 `question`, `priorAnswer`, `priorEvidenceChunkIds`, `followUpHistory` | 继承上一轮证据和会话 |
| 应用/迁移 | `mode=apply` | 后端已支持，要求所有迁移判断仍用 `[chunk_id]` 接地；当前 UI 是否暴露要看具体组件状态 |
| 批注 | `kind=note` | 保存用户 comment，不请求 AI 回答 |

### 3.2 前端触发路径

```text
用户框选原文/译文对应原文块
  -> SelectionToolbarHost / ReaderShell
  -> runDeepInterpretation() 或 runPlainInterpretation()
  -> App.tsx runBackendInterpretation(mode, version, lightweight)
  -> src/core/library-api.ts interpretSelection(request, requestId)
  -> Tauri invoke("interpret_selection")
  -> src-tauri/src/commands.rs interpret_selection()
  -> src-tauri/src/interpretation.rs interpret_with_progress()
```

前端关键文件：

- `src/components/selection/SelectionToolbar.tsx`：选区浮动工具条。
- `src/components/reader/ReaderShell.tsx`：把阅读器选区动作转成 Spark 动作。
- `src/App.tsx`：请求状态、流式事件、fallback、持久化和追问编排。
- `src/core/interpretation-runtime.ts`：判断是否能走后端完整解读。
- `src/core/library-api.ts`：`interpretSelection()` / `listenInterpretationStream()`。

### 3.3 前端发给后端的请求

`InterpretRequest` 定义在 `src-tauri/src/interpretation.rs`。

核心字段：

- `book_id`：限定单书作用域。
- `selection_text`：框选文本，Spark 的不可漂移焦点。
- `page_indexes`：选区所在页。
- `selection_rects`：归一化页坐标矩形，用于证据排序时优先命中几何重叠块。
- `focus_chunk_ids`：前端已知的选区命中 chunk，后端优先读取。
- `question`：追问文本，初始解读为空。
- `prior_answer` / `prior_evidence_chunk_ids` / `follow_up_history`：追问上下文。
- `lightweight`：是否走轻量检索路径。
- `mode`：`deep` / `plain` / `apply`。

### 3.4 流式状态路径

有 `requestId` 时，后端走 `interpret_with_progress()`，并向前端发事件：

```text
interpretation://stream
  planning      正在规划检索
  retrieving    已找到书内证据
  synthesizing  正在生成解读
  delta         流式 token 增量
  done          最终 answer + evidence + trace
  cancelled     用户取消
  failed        出错
```

前端在 `App.tsx` 里通过 `listenInterpretationStream()` 接收事件：

- `planning/retrieving/synthesizing` 更新 UI phase。
- `delta` 追加到当前解读或追问回答。
- `done` 用后端最终答案替换流式草稿，避免未校验 citation 的中间文本留下来。
- `failed/cancelled` 清理 active request。

### 3.5 后端完整检索路径

完整路径在 `src-tauri/src/interpretation.rs`：

```text
interpret_with_progress()
  -> run_retrieval_for_request()
     -> lightweight ? run_lightweight_retrieval()
                  : run_agentic_retrieval_with_model_tools()
  -> synthesis_knowledge_context()
  -> build_messages()
  -> llm::chat_stream_with_cancellation(...)
  -> enforce_grounded_citations()
  -> 返回 InterpretResponse
```

完整 agentic 检索会先尝试模型工具循环：

1. `run_model_tool_loop()`
   - 最多 `MAX_TOOL_ROUNDS = 3`。
   - 每轮最多执行 `MAX_TOOL_CALLS_PER_ROUND = 4` 个工具调用。
   - 用 `llm::chat_with_tools()` 让模型决定调用哪些书内工具。

2. 可用工具来自 `llm::book_retrieval_tools()`：
   - `get_knowledge_context`
   - `search_knowledge`
   - `search_book`
   - `get_chunk`
   - `get_neighbors`
   - `list_structure`

3. 工具执行在 `execute_retrieval_tool_call()`：
   - `search_book` 调 `storage::hybrid_search_book()`。
   - `get_chunk` 调 `storage::get_chunk()`。
   - `get_neighbors` 调 `storage::get_neighbors()`。
   - `list_structure` 调 `storage::list_structure()`。
   - knowledge 相关工具只把知识层结果回落到 evidence chunk，最终仍只能引用 chunk。

4. 工具结果通过 `format_tool_result_prompt()` 回灌给下一轮模型。

如果模型工具循环不可用、没有调用工具、没有新证据或证据太少，后端会启动确定性兜底检索：

```text
run_agentic_retrieval()
  -> 优先读取 focus_chunk_ids
  -> 读取选区所在页 chunks
  -> 继承 prior_evidence_chunk_ids
  -> 根据 selection/question 生成 query
  -> hybrid_search_book 全书检索
  -> search_knowledge_hits 知识层补充
  -> get_neighbors 补前后文
  -> list_structure 在证据不足时兜底
  -> rank_evidence()
```

最终只取 `MAX_SYNTHESIS_EVIDENCE_CHUNKS = 6` 条证据进入合成。

### 3.6 轻量 Spark 检索路径

`lightweight=true` 时走 `run_lightweight_retrieval()`。

它不跑完整模型工具循环，优先：

1. 读取当前选区命中的 `focus_chunk_ids`。
2. 复用上一轮 `prior_evidence_chunk_ids`。
3. 证据不足时从 knowledge hits 补。
4. 仍不足时取当前页少量 chunk。

这个模式适合“直白解释/轻量追问”，成本和等待时间更低，但探索全书证据的能力弱于深度解读。

### 3.7 合成 prompt 和引用校验

合成 prompt 在 `build_messages()`。

系统要求：

- 你是“框选精读”的阅读助理。
- 必须始终以框选文本为焦点，不能漂移到泛泛总结整本书。
- 只能使用给出的 evidence chunks。
- 每个关键判断后用对应 `[chunk_id]` 标注依据。
- 证据不足要明确说，不要编造引用。

后端不会完全信任模型输出。生成后会调用：

```text
enforce_grounded_citations()
  -> rewrite_chunk_citations()
  -> 只保留 evidence 允许集里的 namespaced chunk_id
  -> 如果没有有效引用，追加“可核对证据”脚注
```

也就是说，即使模型输出了不存在的 `[chunk_id]`，后处理也会丢弃它。

### 3.8 本地兜底

如果当前环境不能走完整后端解读：

- 不是 Tauri runtime。
- 当前书还没 indexed。
- 当前 LLM provider 没配置 API key。
- 云端 LLM 调用失败。

前端会走本地兜底：

- `App.tsx runFallbackInterpretation()`
- `App.tsx answerFallbackFollowUp()`
- `src/core/local-interpreter.ts`
- `src/core/local-fallback-chunks.ts`

本地兜底只基于转换稿和已有搜索结果生成可核对解释，`answerSource=local_fallback`。它不能替代完整 LLM 的全书 agentic 解读。

### 3.9 持久化路径

前端在收到答案后调用 `persistInterpretation()`：

```text
App.tsx persistInterpretation()
  -> makeTextQuoteSelector(...)
  -> planInterpretationTurn(...)
  -> evidenceSnapshotsForChunkIds(...)
  -> saveInterpretation(...)
  -> Tauri invoke("save_interpretation")
  -> storage::save_interpretation()
```

SQLite `interpretations` 表保存：

- `selection_text`
- `session_id`
- `turn_index`
- `prefix` / `suffix`
- `page_index` / `page_indexes_json`
- `position_start` / `position_end`
- `evidence_chunk_ids_json`
- `evidence_chunk_snapshots_json`
- `question`
- `answer`
- `answer_source`
- `kind`
- `interpret_mode`
- `created_at`

存储层保存后还会调用 `knowledge::create_card_for_interpretation()`，把解读沉淀为知识层素材。但知识层只做检索增强和导航，最终回答引用仍只认 `[chunk_id]`。

## 4. 两条管线的关系

对照翻译和 Spark 的关系可以简化为：

```text
原文转换稿 / chunks / 坐标 / 索引
      ├─ 对照翻译：页级 LLM 翻译 -> page_translations -> 中文辅助阅读
      └─ Spark：选区原文 -> 检索 chunks -> LLM 合成 -> interpretations
```

翻译不会改变 Spark 的证据系统：

- 在翻译视图选择中文，最终会映射回原文块。
- Spark 请求里的 `selection_text` 应该是原文文本。
- Spark 证据永远来自 `chunks`，不是 `page_translations`。
- 引用跳转依赖 chunk 的页码和归一化 rects，不依赖译文位置。

## 5. 常见误区

1. **误区：翻译也应该走 Spark RAG。**
   - 当前不是。翻译是页级转换任务，不需要检索全书证据；它需要稳定块对齐和缓存。

2. **误区：中文译文可以作为 Spark 引用证据。**
   - 不能。译文可能改写、合并语义或丢格式；最终证据必须回到原文 chunk。

3. **误区：OpenCode agent 已经负责翻译。**
   - 没有。OpenCode host 仍是实验边界，生产翻译路径在 Rust `translation.rs`。

4. **误区：模型输出的 citation 天然可信。**
   - 不可信。后端必须用 `enforce_grounded_citations()` 校验，只允许本轮 evidence 里的 chunk_id。

5. **误区：没有 embedding 就不能 Spark。**
   - 可以。`hybrid_search_book()` 在 embedding 不可用时应降级到 FTS 文本检索。

## 6. 后续改造时的检查清单

改翻译：

- 是否仍保留 `[[B###]]` 或等价确定性块映射？
- 是否更新 `TRANSLATION_PROTOCOL_VERSION` 让旧缓存失效？
- 是否仍按 `provider + model` 隔离缓存？
- 是否保证译文选区映射回原文锚点？
- 是否没有把 key 或 provider 请求放进前端？

改 Spark：

- 是否仍以 `selection_text` 为不可漂移焦点？
- 是否所有工具都限定 `book_id`？
- 是否所有最终引用都能落回 allowed evidence 的 `[chunk_id]`？
- 是否保留 LLM 不可用时的本地兜底？
- 是否保存 `evidence_chunk_snapshots_json` 以便后续审计引用漂移？

快速验证：

```bash
pnpm check:reader
pnpm check:quick
pnpm build
```

若只改文档不用跑测试；若改 `TranslationReader`、`ReaderShell`、`translation.rs` 或 `interpretation.rs`，至少跑 `pnpm check:reader`。
