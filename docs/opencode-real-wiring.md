# OpenCode 真接线设计：翻译 + Spark 迁移

> 状态：**已落地（2026-06-10）**，默认关闭、可一键启用、失败自动回退 Rust。本文既是设计蓝图也是实现记录。
> 与 `docs/opencode-agent.md` 的关系：那篇描述了 host 的隔离/provider/agent 契约（边界规范）；本文给出**真正接线的工程方案、接口、数据流和落地结果**，并修正它遗漏的架构张力。
> 配套阅读：`docs/translation-and-spark-implementation.md`（当前真实代码路径）、`docs/llm-provider.md`、`docs/coordinate-spec.md`。

## 落地状态（已实现）

| 阶段 | 实现 | 关键文件 | 验证 |
|---|---|---|---|
| P0 book-tool server | tokio 手写极简 HTTP/1.1（无新 crate，tokio 加 net+io-util），4 路由 + Bearer 鉴权（空 token 即拒）+ 64KB 上界 + 读超时 + keep-alive | `src-tauri/src/book_tool_server.rs` | 8 单测 |
| P1 sidecar 监督 | mint token → 起 server → spawn agent-host（dev/tsx）→ 解析 agent_host_ready → 退出 SIGTERM；`get_agent_host_url` 命令；setup() hook | `src-tauri/src/agent_host.rs`、`lib.rs`、`commands.rs` | 4 单测 |
| P2 Spark→deep_reader | `interpret_with_progress` 顶部路由 OpenCode；SSE 真实 schema 解析；从 ToolPart 抓 chunk_id，Rust 补全权威 evidence + `enforce_grounded_citations` 二次校验；失败/取消回退 | `src-tauri/src/interpretation.rs`（`opencode_session` 子模块） | 8 单测 |
| P3 翻译→translator | 新增 `translator` agent（文件/shell 全开，cwd 锁沙箱 + external_directory/webfetch=deny）；逐页 materialize 进沙箱 → translator 会话翻译 → 读回 → **块完整性校验**（缺块标 failed）；缓存键加引擎标识隔离 | `agent-host/src/index.ts`、`prompts/translator.md`、`src-tauri/src/translation.rs` | 6 单测 |
| P4 前端切换 | `createAgentTaskRunner({hostUrl, ready})` 守卫切换（mock 兜底）；`opencode-runner.ts` 路由修正为 `/message` + parts；真实事件 schema 解析；`getAgentHostUrl` API + App.tsx 懒加载切换 | `src/core/agent-task/opencode-runner.ts`、`src/core/library-api.ts`、`src/App.tsx` | 9 单测 |

**总验证**：Rust 173 单测全绿（`cargo test --lib -- --test-threads=1`）；前端 312 单测全绿（`pnpm test`）；`cargo check` + `tsc --noEmit` 干净。落地后做了一轮多 agent 对抗审查（安全/正确性/铁律），结论：安全 0 漏洞、铁律 8/8 PASS；修复了 2 个确认 bug：①OpenCode 流式失败回退 Rust 时前端草稿残留 → `synthesizing` 阶段对追问也重置草稿（`App.tsx resetStreamingFollowUp`）；②翻译引擎指纹用 `ready()`（依赖瞬态 host_url）会在 sidecar 中途就绪时让 status 轮询算出不同 key 报 0% → 改用进程稳定的 `opencode_enabled()`。

**启用方式**：设环境变量 `FOCUSED_READING_OPENCODE_ENABLED=1`（或 true/yes/on）。未设时全部走 Rust 内联管线（零行为变化）。book-tool server 始终启动（廉价、进程内）；OpenCode sidecar 仅在启用 + 有 provider key 时 spawn。

**后续工作（已知、未做）**：
- 知识图谱工具上 OpenCode：deep_reader 迁移后失去 `search_knowledge`/`get_knowledge_context`（§4.5 退化）。补法：在 book-tool server 加这两个路由 + agent-host 加对应 `.opencode/tools/*.ts`。属独立增量，未做。
- release 打包：P1 当前 spawn `pnpm --filter ... dev`（开发态）。release 需把 node + agent-host 打进 bundle 或依赖系统 node（P1.b）。
- 跨页术语表（P3.b）：当前逐页独立翻译，术语全书一致性靠单页 prompt；跨页 session glossary 未做。

## 对抗验证修正（实现前已核实，必须遵守）

写代码前对设计中 3 个最高风险假设做了对抗验证（核实 node_modules / skill / tokio），结论修正如下：

1. **OpenCode SDK 路由与骨架不符（P2 必须改）**：真实 `opencode-ai@1.15.13` 发 prompt 是 `POST /session/{id}/message`（不是骨架的 `/session/{id}/prompt`），body 为 `{agent, parts:[{type:"text",text}]}`。SSE 事件是 `{type, properties}` 判别联合：文本走 `message.part.updated`（带 `delta`），工具走 `ToolPart{state:{status,output}}`，结束看 `session.idle`/`session.error`。证据见 `node_modules/.pnpm/@opencode-ai+sdk@1.15.13/.../dist/gen/sdk.gen.js` + `types.gen.d.ts`。
2. **tokio 手写 HTTP 的真实坑（P0 必须加固）**：禁止用 `read_line()` 读 body（JSON 内 `\n`/`\r\n` 会截断）→ 解析 `Content-Length` 后 `read_exact()`；处理 keep-alive（Node undici 默认复用连接，逐请求循环读）；拒绝 `Content-Length` 缺失/>64KB/非法；设读超时防挂死。
3. **baoyu skill 与逐块对齐架构冲突（P3 重定向）**：baoyu 原则是「Rewrite, not translate」+「Break long sentences」，会合并/拆分/重排段落，**与 `[[B###]]` 严禁合并/拆分/重排的对齐契约根本冲突**；且 baoyu 有 EXTEND.md 之外跳不过的交互闸门（normal 完「继续润色」、quick 长文警告、图片提醒）。**决策（用户拍板）：OpenCode 真跑翻译，但用一份 app-owned 的「baoyu 适配副本」**——见 §5 重写。

## 0. 一句话结论

OpenCode 是一个**独立的 Node 子进程**，它读不到 Rust 进程内的 SQLite。要让 Spark 和翻译在 OpenCode 里执行，必须先建一座桥——**Rust 端的 book-tool HTTP server（127.0.0.1:48173）**——这是 OpenCode 拿到书证据的唯一通道。这座桥是 P0，缺它则一切迁移失明。

迁移后两条管线共享同一个 OpenCode server（端口 48172），但用**两个权限完全不同的 agent**：

| 管线 | OpenCode agent | 权限 | 数据来源 | 产物落点 |
|---|---|---|---|---|
| Spark / 解读 / 追问 | `deep_reader`（已存在） | 只读：仅 4 个 book 工具，deny shell/edit/web/task | book-tool server → SQLite chunks | `interpretations` 表 |
| 对照翻译 | `translator`（**本设计新增**） | 文件/shell 全开，但 **cwd 锁沙箱 + external_directory=deny + webfetch=deny** | 沙箱内的页/块 markdown | `page_translations` 表 |

## 1. 三进程架构（为什么需要 book-tool server）

```
┌──────────────────┐    Tauri IPC    ┌─────────────────────────────┐
│  前端 (WebView)  │ ───────────────>│  Rust 核心进程               │
│  React / TS      │ <───────────────│  - SQLite（书的全部真相）    │  ← chunks/坐标/FTS/embedding
└──────────────────┘   事件/命令      │  - interpretation.rs（兜底）│
        │                             │  - translation.rs（兜底）   │
        │ get_agent_host_url          │  - book-tool server :48173  │ ★ 新增（P0）
        │ interpret_selection         └─────────────────────────────┘
        │ start_translation                  ▲ HTTP POST /tools/*  ▲
        ▼                                     │ Bearer token        │
┌──────────────────────────────────────────────────────────────────┐
│  OpenCode 子进程（Node，:48172） — Tauri spawn（P1）              │
│  ├─ deep_reader   ：Spark 检索回答（P2）   调 book_* 工具 ────────┘
│  └─ translator    ：跑 baoyu-translate skill（P3）调 book_* + 文件
│  provider key 经 env 注入；沙箱状态写 agent-host/.state/          │
└──────────────────────────────────────────────────────────────────┘
```

关键事实（已核实）：

- `agent-host/src/index.ts` 用 `createOpencode()` 起独立 Node server，进程内存与 Rust 不共享。
- `agent-host/opencode/.opencode/lib/book-tool-client.ts` 已写死：所有 book 工具 `POST ${FOCUSED_READING_BOOK_TOOL_BASE_URL}/tools/{name}`（默认 `http://127.0.0.1:48173`），带 `Authorization: Bearer {FOCUSED_READING_BOOK_TOOL_TOKEN}`。
- 该 48173 server **当前不存在**（`grep opencode src-tauri` 零命中）。
- Rust 当前**没有任何 HTTP server crate**，只有 `reqwest`（client）+ `tokio`（features 仅 `macros/rt-multi-thread/time`，无 `net`）。

## 2. P0：Rust book-tool HTTP server（:48173）

### 2.1 必须实现的 HTTP 契约（由 `book-tool-client.ts` + 4 个工具反推，精确）

所有路由：`POST /tools/{name}`，`Content-Type: application/json`，请求头 `Authorization: Bearer {token}`，body 为 camelCase JSON，响应为 JSON。鉴权：token 为空或不匹配 → `401`（**空 token 即拒**，对齐铁律）。仅绑 `127.0.0.1`。

| 路由 | 请求 body | Rust 复用函数（已核实签名） | 响应 |
|---|---|---|---|
| `POST /tools/book_search` | `{bookId, query, limit?=6}` | `storage::hybrid_search_book(db, book_id, query, limit)` | `SearchHit[]`，每项含 `chunk_id` |
| `POST /tools/book_get_chunk` | `{bookId, chunkId}` | `storage::get_chunk(db, book_id, chunk_id)` | 单 chunk JSON |
| `POST /tools/book_get_neighbors` | `{bookId, chunkId, radius?=1}` | `storage::get_neighbors(db, book_id, chunk_id, radius)` | `SearchHit[]` |
| `POST /tools/book_structure` | `{bookId}` | `storage::list_structure(db, book_id)` | 结构/页首 chunk 列表 |

返回的 chunk_id 必须是 `chunk_id::is_namespaced_chunk_id` 认可的 namespaced 形式，OpenCode agent 才能把 `[chunk_id]` 原样保留供前端跳转。**复用 `interpretation.rs` 现有检索，不重复实现。**

健康检查：`GET /health` → `200 {"ok":true}`，供 P1 探活。

### 2.2 server 选型对比（待你最终拍板）

| 维度 | 方案 A：tokio 手写极简 HTTP/1.1 | 方案 B：引入 axum |
|---|---|---|
| 新增 crate | 0（仅给 tokio 加 `net`+`io-util` feature） | `axum=0.7.x` + 传递依赖 tower/hyper/http/http-body/matchit 等 ~15 个 |
| 代码量 | 中（~200 行：手解 request line + headers + body，4 路由 + 鉴权） | 小（~80 行 router） |
| 鲁棒性 | 需自己处理分块/keep-alive/边界；但本场景是受信本机单客户端，可只支持最简 POST | 成熟，覆盖边界 |
| 铁律契合 | 完美：依赖面零增长，无新审计项 | 需 `=` 锁全部新依赖，扩大 bundle 与 cargo-audit 面 |
| 风险 | 手写 HTTP 解析有坑（content-length 边界、超大 body） | 引入大依赖树，与已锁的 tauri/tokio 版本可能有 feature 冲突 |

> **设计推荐：方案 A（tokio 手写）**。理由：(1) 客户端只有本机 OpenCode 一个，请求形态固定（4 条小 POST），不需要通用 HTTP 框架；(2) 依赖面零增长直接满足「`=` 锁版本 + 最小审计面」铁律；(3) body 大小可硬限上界（如 64KB）防滥用。把它实现为一个独立模块 `src-tauri/src/book_tool_server.rs`，单测覆盖鉴权拒绝 + 4 路由 happy path。
>
> 若 review 后倾向稳健优先，方案 B 亦可——届时把新依赖全部 `=` 锁并补一条「book-tool server 依赖来源」说明。

### 2.3 生命周期与状态

- server 在 Tauri `setup()` 里 spawn 一个 tokio task 监听 48173；token 由 P1 每次启动随机生成（见下）。
- server 需要 `db_path`：通过 `tauri::State` 或在 spawn 时把 `library_db_path` 闭包进 task。注意：当前 lib.rs **没有 setup() hook 也没有 State**——P0/P1 要新增。
- 端口可被 `FOCUSED_READING_BOOK_TOOL_PORT` 覆盖（默认 48173），解决端口冲突。

## 3. P1：Tauri spawn agent-host sidecar

### 3.1 启动流程

在 `lib.rs` 的 `tauri::Builder` 上新增 `.setup(|app| { ... })`：

1. 生成 per-run token：`FOCUSED_READING_BOOK_TOOL_TOKEN`（随机 32 字节 hex；用现有依赖即可，避免引入 rand）。
2. 启动 P0 的 book-tool server（48173，带该 token）。
3. spawn agent-host 子进程（`std::process::Command` 或 `tokio::process`——注意 tokio 当前无 `process` feature，需加，或用 std + 线程读 stdout）。注入 env：
   - `FOCUSED_READING_LLM_PROVIDER` + 对应 `*_API_KEY`/`*_BASE_URL`/`*_MODEL`（从 `config::llm_config()` 读，**只在 Rust 侧读 key，不进前端**）。
   - `FOCUSED_READING_BOOK_TOOL_BASE_URL=http://127.0.0.1:48173`、`FOCUSED_READING_BOOK_TOOL_TOKEN={token}`。
4. 解析 agent-host stdout 的 `{"type":"agent_host_ready","serverUrl":...}` JSON 行，存到 `tauri::State<AgentHostState>`。
5. 暴露命令 `get_agent_host_url() -> Option<String>`（注册进 `generate_handler!`），前端用它替代硬编码 `DEFAULT_OPENCODE_BASE_URL`。
6. 退出时 SIGTERM 子进程（`on_window_event` / `RunEvent::Exit`）。

### 3.2 启动模式

- 开发态：spawn `pnpm --filter @focused-reading/agent-host dev`。
- release：需把 node + agent-host 打进 bundle 或依赖系统 node。**这是 P1 的主要打包难点**，本设计先支持开发态，release 打包列为 P1 子任务 P1.b（可后做）。
- host 未就绪 / spawn 失败：不阻塞 app 启动，`get_agent_host_url` 返回 `None`，Spark/翻译自动走 Rust 兜底（见 §4.3 / §5.5）。

## 4. P2：Spark 迁到 OpenCode `deep_reader`

### 4.1 现状回顾（已核实，保持契约不变）

- 前端：`App.tsx interpretSelection()` → `interpret_selection` 命令；流式经 `listenInterpretationStream()` 收 `interpretation://stream` 事件（stages: planning/retrieving/synthesizing/delta/done/cancelled/failed）。
- 后端入口：`commands.rs:1033 interpret_selection` → `interpretation::interpret_with_progress(app, request_id, db_path, request)`。
- 返回 `InterpretResponse { answer, answer_source, evidence: EvidenceItem[], trace: AgentTraceStep[] }`。
- 关键不变量：`enforce_grounded_citations()` 只保留 evidence 允许集里的 `[chunk_id]`。

### 4.2 迁移设计

新增 `interpretation::interpret_via_opencode(app, request_id, db_path, request, host_url)`，与现有 Rust 内联循环并存。`interpret_with_progress` 顶部做路由：

```text
if opencode_enabled() && agent_host_ready() {
    interpret_via_opencode(...)   // 走 OpenCode deep_reader
} else {
    <现有 Rust 内联工具循环>        // 兜底，零改动
}
```

`interpret_via_opencode` 内部：

1. `emit planning`。
2. `POST {host_url}/session` 建会话 → 拿 sessionId。
3. `POST {host_url}/session/{id}/message`（**修正：不是 /prompt**），body `{agent:"deep_reader", parts:[{type:"text", text: <注入的 prompt>}]}`。prompt 内必须注入：选区文本（不可漂移焦点）、page_indexes、focus_chunk_ids、追问上下文（question/prior_answer/follow_up_history）。
4. `GET {host_url}/event`（SSE）订阅，按真实事件 schema 解析：
   - `message.part.updated` 且 `part.type=="tool"` 且 `state.status=="completed"` → 从 `state.output` 累积 evidence（chunk_id + 文本），`emit retrieving`。
   - `message.part.updated` 且 `part.type=="text"`（带 `delta`）→ `emit delta`。
   - `session.idle` → 完成；`session.error` → 失败回退。
5. **关键安全步骤**：拿到 OpenCode 的 answer 后，仍在 **Rust 侧**跑 `enforce_grounded_citations(answer, request, evidence)`。OpenCode 的引用不天然可信，必须用本轮 evidence 的 allowed-set 二次校验。
6. evidence 的 chunk 快照（title/page/rects）由 Rust 用 `storage::get_chunk` 补全——OpenCode 只回 chunk_id，坐标真相永远在 Rust。
7. `emit done { answer, answer_source: Llm, evidence, trace }`。
8. 取消：`cancel_interpretation(request_id)` → `POST {host_url}/session/{id}/abort`。

### 4.3 失能与回退（必须保留）

OpenCode 路径在以下情况**自动回退 Rust 内联循环**，不让用户看到失败：host 未就绪 / session 建立失败 / SSE 中断 / 校验后 evidence 为空 / 超时。回退后 `answer_source` 仍如实标注。本地兜底（`local-interpreter.ts`，非 Tauri / 未索引 / 无 key）保持不变。

### 4.4 开关

`opencode_enabled()` 读一个设置项（默认关，灰度开），存进 llm-settings。这样可一键回到纯 Rust 路径，便于对比与回滚。

### 4.5 退化风险登记（如实记录）

迁到 OpenCode 后，相比 Rust 内联循环会**失去**：进程内零延迟（多一次跨进程 + SSE）、`chat_stream_with_cancellation` 的精细 token 流、确定性兜底检索的 6 工具编排（OpenCode deep_reader 只有 4 工具 + maxSteps=6）。`get_knowledge_context`/`search_knowledge` 两个知识层工具在 OpenCode 侧**当前没有**——P4 决定是否补到 book-tool server 以保住知识图谱增强。**因此默认关、可回退是硬要求。**

## 5. P3：翻译走 OpenCode `translator` agent（真跑 baoyu-translate skill）

### 5.1 核心架构张力（已核实，必须正视）

- baoyu-translate 的 `scripts/main.ts` **只做 chunk 切分**，输出 `chunks/chunk-NN.md`；真正的翻译动作是**宿主 agent 的 LLM 读 prompt 后执行**的。
- chunked 模式**需要 Agent/task 工具** spawn subagent 并行翻译；headless 退化为顺序内联。
- 因此跑 skill 的 agent 必须有 `read/edit/write/bash/task` 权限——这与只读的 `deep_reader` **互斥**。
- 决策：**新增独立 agent `translator`**，权限全开但 **cwd 锁沙箱 + `external_directory=deny` + `webfetch=deny`**（爆炸半径限定在一次性 workspace；provider key 仍在 sidecar 进程内，沙箱阻止其外泄到网络）。

### 5.2 沙箱 workspace 布局（app-owned，绝不污染用户全局 OpenCode）

```
agent-host/.state/translate/{bookId}/          ← translator agent 的 cwd（.gitignore）
  .baoyu-skills/baoyu-translate/EXTEND.md      ← 预置，跳过 BLOCKING 首次设置
  source/page-{NNNN}.md                        ← Rust 导出的「按 [[B###]] 编号的页 markdown」
  source-{target}/                             ← baoyu 输出目录
    translation.md / chunks/chunk-NN-draft.md
```

预置 `EXTEND.md`（关键：跳过交互式首次设置）：

```yaml
target_language: zh-CN
default_mode: normal          # 默认 normal；用户要精翻时切 refined
audience: academic
style: academic
chunk_threshold: 4000
chunk_max_words: 5000
glossary: []                  # P3.b：用跨页术语表回填
```

### 5.3 translator agent 配置（agent-host/src/index.ts 新增）

在 `buildOpencodeConfig` 的 `agent` 里新增：

```text
translator: {
  mode: "primary",
  maxSteps: 24,                       // 翻译需要多步：分析→切块→译→合并
  model: 同 provider/model,
  prompt: 读 prompts/translator.md,
  permission: { edit:"allow", bash:"allow", webfetch:"deny", external_directory:"deny" },
  tools: { read:true, edit:true, write:true, bash:true, task:true,
           webfetch:false, websearch:false,
           book_search:true, book_get_chunk:true, ... },  // 可选给 book 工具做术语对齐
}
```

host 启动时 `process.chdir` 仍指 opencode worktree；但 translator 会话的工作目录通过 prompt 显式指定为沙箱路径，且 `external_directory=deny` 阻止越界。

### 5.4 翻译数据流（保持 page_translations 契约 + 块对齐）

```text
前端 start_translation(bookId, force)
  -> commands.rs start_translation（路由：opencode_enabled && host_ready ?）
       是 -> translation::translate_via_opencode(...)
       否 -> translation::start_translation(...)   // 现有 Rust 逐页，零改动兜底

translate_via_opencode:
  1. Rust 按页读转换稿，marked_translation_source() 加 [[B001]] 编号
     -> 写沙箱 source/page-{NNNN}.md（保留现有块编号算法，不变）
  2. 预置 EXTEND.md（mode=normal 或 refined，按请求）
  3. POST {host_url}/session 建 translator 会话
  4. prompt 指示：对沙箱内每页 markdown 跑 baoyu-translate normal/refined，
     保留 [[B###]] 块编号，输出到约定路径
  5. SSE 跟踪进度 -> 映射成 TranslationStatus 的 completed_pages（前端 2.5s 轮询不变）
  6. Rust 解析输出：按 [[B###]] 把译文切回页/块
     -> 校验：每个输入块有对应输出块；编号无合并/拆分/重排/跳过
     -> 写 page_translations（逐页一行，schema 不变）
  7. 解析失败的页标 status=failed 保留 error（不污染缓存）
```

**不变量（对齐 docs 铁律 + opencode-agent.md）**：
- 译文选区仍映射回原文 chunk（`TranslationReader.tsx` 逻辑不变）；译文永不作为 Spark 证据。
- 输出必须保留 `[[B###]]` 或等价确定性块映射，否则该页判失败。
- 沙箱一次性：翻译完成后可清理；绝不写用户全局 `~/.config/opencode`。

### 5.5 缓存键升级（关键：防止旧缓存被当新格式用）

当前主键 `(book_id, page_index, source_fingerprint, provider, model)`，`source_fingerprint` 内含 `TRANSLATION_PROTOCOL_VERSION="block-v3-baoyu-normal"`。

迁移后**引擎/模式/skill 版本变了**，必须让旧缓存失效：

- 把 `TRANSLATION_PROTOCOL_VERSION` 升级为含引擎标识，如 `opencode-baoyu-1.59.0-normal`（含 baoyu skill version）。
- mode（normal/refined）也进指纹——refined 译文质量不同，不能复用 normal 缓存。
- provider/model 已在主键，无需改 schema，**仅改 fingerprint 组成**即可自然失效旧缓存。

### 5.6 「分小区段翻译是否依然合理」——设计结论

**保留页级 + `[[B###]]` 块切分，不换成 baoyu 的 4000 词 chunk。** 两者服务不同目标：
- baoyu chunk 为「产出一篇可读文章」，会跨页合并/重排段落 → 破坏对照 rail 对齐和译文→原文锚点。
- 你的页/块切分为「逐块挂回原文坐标 + 译文选区映射回 chunk」，是坐标契约的一部分，不可动。

正确做法是**分层**：底层切分单位仍是页/块（对齐契约）；上层借 baoyu 的**质量工序**（normal 两段式分析→翻译、refined 审校润色、跨页 session glossary 术语一致）。沙箱里每页作为 baoyu 的一个翻译单元跑，但译文必须按 `[[B###]]` 回切。

### 5.7 跨页术语一致（P3.b，当前最大质量短板）

现状逐页独立翻译，同一术语在第 3 页和第 30 页可能不一致。借 baoyu 的 session glossary：
1. 翻译前先让 translator 扫全书（或抽样章节）抽取术语 → 写入沙箱 EXTEND.md 的 `glossary`。
2. 逐页翻译时该术语表作为共享上下文（baoyu 的 `02-prompt.md`），保证全书一致。
3. 术语表进缓存指纹，术语变更则相关页失效。

## 6. P4：知识图谱增强 + 全量验证

### 6.1 知识图谱与 OpenCode 正交（澄清）

「知识图谱让 Spark 更合理」成立，但它和「执行引擎是否 OpenCode」是两件事。知识层增强在 Rust 侧做：
- 现状 `knowledge::create_card_for_interpretation` 已把解读沉淀为卡片；`search_knowledge`/`get_knowledge_context` 已回灌检索（但仅 Rust 内联循环可用）。
- P4 决定：是否把 `book_search_knowledge` / `book_knowledge_context` 两个工具**加到 book-tool server**，让 OpenCode deep_reader 也能用知识图谱增强检索（否则迁移后 Spark 的知识层能力退化，见 §4.5）。
- 强化方向：实体/关系抽取、跨选区关联、图遍历检索——均在 Rust knowledge 模块，与 OpenCode 无关。

### 6.2 前端 runner 切换

`createAgentTaskRunner()` 现硬编码返回 mock。P4 改为：`opencode_enabled && host_ready ? new OpencodeAgentTaskRunner({baseUrl: get_agent_host_url()}) : new MockAgentTaskRunner()`。校验 `opencode-runner.ts` 的路由常量与 SSE 事件 schema 对齐真实 `opencode-ai@1.15.13`。

### 6.3 验证矩阵

```bash
pnpm check:reader     # 改 TranslationReader/ReaderShell/translation.rs/interpretation.rs 必跑
pnpm check:quick
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml   # book_tool_server 单测
```

手动 smoke（host 起来后）：设 provider key → 开书 → Spark 框选解读（确认 [chunk_id] 可跳转）→ 启动翻译（确认逐页对齐 + 缓存命中）。

## 7. 分阶段计划与依赖

| 阶段 | 内容 | 依赖 | 可独立验证 | 风险 |
|---|---|---|---|---|
| **P0** | book-tool server :48173（4 路由 + Bearer 鉴权 + 单测） | 无 | curl + cargo test | 低（手写 HTTP 解析） |
| **P1** | Tauri setup() spawn sidecar + token + get_agent_host_url + 退出清理 | P0 | 开发态启动看 agent_host_ready | 中（release 打包 = P1.b 后做） |
| **P2** | Spark 迁 deep_reader（路由 + SSE + 二次引用校验 + 回退 + 开关） | P0,P1 | 开关切换对比 Rust vs OpenCode | 中（退化风险，默认关） |
| **P3** | translator agent + 沙箱 + materialize→skill→回切→page_translations + 缓存键升级 | P0,P1 | 翻一本书看对齐 + 缓存 | 高（skill headless 行为、块回切） |
| **P3.b** | 跨页术语表 | P3 | 术语一致性抽查 | 中 |
| **P4** | 知识层工具补到 server + 前端 runner 切换 + 全量验证 + 文档/记忆更新 | P0–P3 | 验证矩阵 | 低 |

## 8. 安全红线（落地时逐条核对）

1. provider key 只经 env 注入 sidecar，绝不进前端 bundle、绝不写用户全局 OpenCode auth。
2. book-tool server 空 token 即拒（`401`），仅绑 `127.0.0.1`，body 大小硬上界。
3. translator agent：`webfetch=deny` + `external_directory=deny` + cwd 锁沙箱；PDF 内容视为不可信输入（防 prompt 注入 → 沙箱限爆炸半径）。
4. 沙箱 `agent-host/.state/` 已 `.gitignore`；翻译完成清理临时文件。
5. Spark/翻译的最终引用与坐标真相永远在 Rust（chunk_id + rects），OpenCode 只回 chunk_id。
6. 每阶段保留 Rust 兜底路径 + 开关，可一键回退。

## 9. 改动文件清单（预估）

**Rust（src-tauri/src/）**：
- 新增 `book_tool_server.rs`（P0）。
- `Cargo.toml`：tokio 加 `net`/`io-util`（+ 可能 `process`）feature；方案 B 则加 axum（`=` 锁）。
- `lib.rs`：`.setup()` hook + State + 新命令注册（`get_agent_host_url`）。
- `commands.rs`：`get_agent_host_url`；`interpret_selection`/`start_translation` 加 OpenCode 路由。
- `interpretation.rs`：`interpret_via_opencode` + 路由 + 二次校验复用。
- `translation.rs`：`translate_via_opencode` + 沙箱 materialize + 回切解析；`TRANSLATION_PROTOCOL_VERSION` 升级。
- `config.rs`：`opencode_enabled` 设置项 + sidecar env 组装。

**agent-host/**：
- `src/index.ts`：新增 `translator` agent 配置。
- `opencode/prompts/translator.md`：新增（驱动 baoyu skill 的系统 prompt）。
- 沙箱 EXTEND.md 模板。

**前端（src/）**：
- `core/library-api.ts`：`getAgentHostUrl()`。
- `core/agent-task/opencode-runner.ts`：`createAgentTaskRunner` 守卫切换 + 路由校验。
- `App.tsx`：runner 注入用 host url。

**文档/记忆**：本文、`opencode-agent.md` 状态更新、记忆更新。
