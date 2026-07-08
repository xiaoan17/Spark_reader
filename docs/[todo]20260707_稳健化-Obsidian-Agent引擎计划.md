# 2026-07-07 · 稳健化 + Obsidian 打通 + Agent 引擎演进计划

> 状态:[todo] 计划文档,作为本轮工作的阶段性检查总控。
> 三条主线:**A. 项目稳健化**、**B. Obsidian 打通**、**C. Agent 引擎(OpenCode → Codex?)**。
> 每个阶段末尾有验收 checklist,勾完才进下一阶段。

---

## 0. 反思:现状盘点(2026-07-07 逐条核实,非凭记忆)

### 做得好的(不要动摇的地方)

- **工程纪律高于一般 pre-1.0**:坐标契约+单测、FTS 防注入、zip 防 symlink、markdown XSS 防护、依赖 `=` 锁版本,这些在 2026-06 的 18 条多维 review 后基本兑现。
- **CI 已补齐**(修正旧结论):`.github/workflows/ci.yml` 已含测试构建 + `cargo audit` + `pnpm audit`,旧 review 里"缺 CI/cargo-audit"已解决。
- **降级链路完整**:Spark 走 OpenCode 失败自动回退 Rust 进程内 agentic 循环,再退 deterministic fallback(`interpretation.rs`),不会因 sidecar 挂掉丢功能。
- **数据通道设计正确**:`book_tool_server.rs`(549 行,tokio 手写 HTTP、Bearer 鉴权、仅绑 127.0.0.1)是 OpenCode/未来任何外部引擎读书本数据的唯一通道,这个抽象本身与引擎无关,**换引擎它可以原样复用**。
- **知识导出已有地基**:`export_book_knowledge_markdown` / `export_book_knowledge_json`(`knowledge/mod.rs:109`)已能渲染整书知识 Markdown —— Obsidian 打通不用从零写。

### 仍脆弱的(按风险排序)

| # | 问题 | 现状核实 | 风险 |
|---|---|---|---|
| 1 | **密钥最后一公里** | `Cargo.toml` 仍无 keyring,key 明文落 `.env`;Windows 文件权限收紧是空实现 | High:桌面分发后 key 泄露面扩大;dmg 已在向外发(`release:dmg`) |
| 2 | **OpenCode 路径是 dev 态** | `tauri.conf.json` 无 externalBin/sidecar;启用靠 `FOCUSED_READING_OPENCODE_ENABLED=1` + 本机 pnpm | Medium:打包版用户永远走不到 OpenCode 路径,功能双轨长期漂移 |
| 3 | **引擎硬编码为 OpenCode** | `interpretation.rs` / `translation.rs` 直接 `opencode_session::` / `translate_opencode`,无引擎抽象层 | Medium:换/加引擎(Codex)要动核心文件,正是这次 C 主线要解的 |
| 4 | **向量检索全表扫描** | 未变;大书(>500页)检索延迟随书增长 | Medium,量变问题 |
| 5 | **手动重建索引冻结 UI ~45s** | 未变,同步调 embedding | Low-Medium,体验问题 |
| 6 | **prompt cache 命中率无观测** | 未变 | Low,成本盲区 |
| 7 | **文档整理未提交** | git status 里 20+ 个 docs 改名([finish]/[todo] 前缀化)悬在工作区 | Low 但应先落库,否则任何回滚都会搅乱这次整理 |

### 反思结论

上一轮(06-10 OpenCode 真接线)把"能不能跑"解决了,这一轮的主题应该是**"能不能交付、能不能演进"**:密钥收进系统钥匙串(交付安全)、引擎抽象化(演进能力)、Obsidian 打通(价值出口——读了半天的东西要能沉到用户自己的知识库)。

---

## A 主线:稳健化

### A1(P0)密钥迁移 keyring

- 引入 `keyring` crate(锁版本),macOS 走 Keychain,Windows 走 Credential Manager。
- 迁移策略:首次启动检测 `.env` 有 key → 写入钥匙串 → `.env` 中该项替换为 `moved-to-keychain` 占位;读取顺序 钥匙串 → `.env`(兼容旧布局)→ 无。
- **已明文落盘过的真实 key 提示用户轮换**(设置页一次性 banner)。
- `.env` 继续承载非敏感配置(开关、URL)。

### A2(P1)工程卫生

- 先提交当前工作区的 docs 整理(独立 housekeeping commit,不与代码混)。
- ~~CI 增加 `pnpm secret-scan`~~ 复核发现 CI 早已挂了(计划时判断有误);但 2026-07-07 修复了
  `secret_scan.sh` 的真实 bug:`git ls-files` 未关 `core.quotePath`,**中文文件名全被转义、
  rg 打不开、一直没被扫描**;顺带过滤 tracked-but-deleted 文件。已修并本地验证通过。
- 索引重建改为后台任务 + 进度事件,解 45s 冻结(可延后到 B/C 之后)。

### A 验收

- [ ] macOS 钥匙串里能看到 key,`.env` 无明文 key,功能回归通过(`pnpm check:quick` + `cargo test --lib -- --test-threads=1` 全绿)
- [ ] 旧 `.env` 用户升级后无感迁移(手工模拟一次)
- [ ] docs 整理已单独成 commit
- [ ] CI 跑 secret-scan

---

## B 主线:Obsidian 打通

### 目标

阅读中产生的高亮、Spark 解读、笔记,一键落到用户 Obsidian vault 的指定目录;整书知识可全量导出。**直接写文件系统,不依赖 Obsidian 插件/URI、不要求 Obsidian 在运行。**

### 设计(v1 从简)

1. **设置项**(config.rs + 设置页):
   - `obsidian_vault_path`:vault 根目录(校验目录存在即可,不强制有 `.obsidian/`)
   - `obsidian_subdir`:默认 `框选精读/`
   - 开关:未配置时所有入口隐藏
2. **文件布局:每本书一个 app 专属文件** `{vault}/{subdir}/{书名}.md`
   - 文件头 frontmatter:`source: 框选精读`、book_id、authors、created
   - 每次"发送到 Obsidian"**追加**一个片段块:时间戳 + 页码 + `> [!quote]` 原文引文 + 解读/笔记正文 + `chunk_id` 注脚
   - **只追加,绝不覆盖/删除**;写入用 temp+rename 原子写;文件被用户改过也不受影响(追加语义)
3. **入口**:
   - 高亮卡片 / Spark 解读卡片上加"存到 Obsidian"按钮
   - 书籍知识页加"整书知识导出到 Obsidian"(复用 `export_book_knowledge_markdown`,独立文件 `{书名}-知识图谱.md`,此文件可整体覆盖重写,因为它是纯生成物)
4. **Rust 命令**:`export_snippet_to_obsidian` / `export_book_knowledge_to_obsidian`,路径校验(必须在 vault 内、拒绝 `..`),单测覆盖追加/原子写/路径逃逸。

### 明确不做(v1)

- 不做双向同步、不做从 Obsidian 读回、不做自定义 URI 回跳阅读器(记为 v2 候选)。

### B 落地记录(2026-07-07)

- Rust:`src-tauri/src/obsidian.rs`(追加导出/生成物导出/路径逃逸防护/原子写,5 单测)+
  config.rs Obsidian 设置三件套 + 4 个 Tauri 命令(get/save settings、export_snippet、export_book_knowledge)。
- 前端:`ObsidianSettingsPanel`(独立 modal,LLM 设置页脚入口 + 未配置导出时自动打开)、
  Spark 卡片「存到 Obsidian」、选区浮条 SelectionToolbar 高亮导出(项目无独立高亮卡片组件,
  动作位在浮条,双阅读器都接)、知识面板「导出到 Obsidian」;反馈走 pushNotice;
  web 模式优雅降级(不触桥)。

### B 验收

- [x] 片段格式正确:frontmatter(source/book_id/created)+ `> [!quote]` callout + 来源块注脚(Rust 单测断言)
- [x] 连续发送为追加、不丢用户手工编辑、frontmatter 不重复(Rust 单测)
- [x] 失败态:路径逃逸/绝对路径/vault 不存在均拒绝(单测);前端未配置时提示并打开设置,错误走 pushNotice
- [x] 新增 Rust 单测 + ObsidianSettingsPanel story(6 态)+ 组件测试;`pnpm check:quick` 117 文件/658 测试全绿
- [ ] B5(遗留):真机对着真实 vault 手工走一遍(配 vault → 框选 → 存 → Obsidian 里打开确认渲染)

---

## C 主线:Agent 引擎(OpenCode → Codex 评估)

### 对"直接替换成 Codex"的诚实评估

**可行**:Codex 有 `codex exec --json` 无头模式(JSONL 事件流)、MCP 工具挂载(book-tool server 可包一层 MCP bridge 或直接 HTTP 工具)、会话续接、沙箱模式;翻译/Spark 两个 agent 都能映射过去。

**但不建议一步到位整体替换,理由:**

1. 现有 OpenCode 接线(~1200 行:agent_host + book_tool_server + 两个 session 模块)是经对抗验证修正过 3 个真实坑才稳定的,推倒重来会把这些学费再交一遍。
2. 项目铁律 #5 是 **LLM 多 provider 可切换、默认 DeepSeek**;Codex 以 OpenAI 模型为一等公民,DeepSeek 走 `model_providers` 兼容层是二等体验。整体替换 = 把引擎选择权交给单一厂商。
3. "替换是否更好"目前是感觉,不是数据。仓库里已有 `pnpm eval:rag`,应该**用 eval 决策,不用 vibes 决策**。

### 建议路线:引擎抽象 + Codex 并列接入 + eval 定去留

1. **C1 引擎抽象**:Rust 侧抽 `AgentEngine` 接口(启动会话/发送/事件流/取消/健康检查),现有三条路径归位为三个实现:`rust-inline`(兜底)、`opencode`、`codex`(新)。开关从布尔改为 `FOCUSED_READING_AGENT_ENGINE=rust|opencode|codex`。`book_tool_server` 不动,继续做唯一数据通道。
2. **C2 Codex 接入(spike)**:`codex exec --json` 起子进程,book 工具经 MCP bridge(薄封装,转调现有 48173 HTTP);先只接 Spark(deep_reader),翻译后接。
3. **C3 eval 对比**:同一组框选精读任务跑三引擎,比较回答质量(chunk_id 引用命中率)、延迟、成本;翻译比逐块对齐完整率。
4. **C4 决策**:eval 赢家成为默认引擎,输家降级为 fallback 或删除;届时再做 sidecar 打包(A 线遗留的 #2,打包对象取决于引擎决策,所以排在最后)。

### C 落地记录(2026-07-07,按"直接整体替换"口径执行完毕)

**替换后架构**(比 OpenCode 版少一个常驻进程):

```
前端 ↔ Rust 核心(SQLite 真相)
          ├─ book_tool_server.rs :48173(新增 /mcp streamable-HTTP MCP 端点,Bearer 鉴权)
          └─ 每请求 spawn `codex exec --json`(读 stdout JSONL 事件,用完即走)
                └─ codex 经 MCP 直连 /mcp 拿 book 工具(rmcp 客户端,已实测打通)
```

**关键实现**:
- `src-tauri/src/codex_exec.rs`(新):共享 runner。事件解析(thread.started/item.*/turn.*)、
  stdin 喂 prompt、超时/取消杀进程、二进制探测(含 GUI 启动 PATH 缺失的 Homebrew 回退)。
- `book_tool_server.rs` `/mcp` 端点:initialize/tools/list/tools/call/ping,工具错误按 MCP 规范
  进 result(isError)不进协议错误;notification 回 202。**无需任何 Node bridge**。
- `interpretation.rs` `codex_session`:替换 `opencode_session`;chunk_id 从 mcp_tool_call item
  深度提取(含 JSON-in-string),引用仍在 Rust 侧重新校验(铁律不变)。
- `translation.rs` `translate_codex`:替换 `translate_opencode`,**去掉了整个文件沙箱机制**
  (prompt 进、译文出,`--sandbox read-only` 无工具),Rust 逐块校验兜底不变;缓存引擎标签
  `codex-aligned-1` 与旧缓存自然隔离。
- prompt 资产迁移:`src-tauri/prompts/{deep-reader,translator}.md` 经 `include_str!` 编译进二进制
  (打包不再依赖外部 prompt 文件)。
- **agent-host Node 包与全部 opencode-ai 依赖已删除**,pnpm workspace/lockfile 已更新。
- 硬边界(每次 spawn 显式传,绝不继承用户全局 `danger-full-access` 配置):
  `--sandbox read-only`、`-c approval_policy="never"`、`-c mcp_servers=...`(整表替换,实测确认
  能屏蔽用户全局 MCP server)、cwd 锁定到中性空目录、token 走环境变量。
- 开关:默认启用(codex 即脚手架),`FOCUSED_READING_CODEX_DISABLED=1` 强制回退 Rust。
  回退链:codex → rust 进程内管线 → deterministic fallback。

**实测修正过研究报告的坑**:`codex exec` 没有 `--ask-for-approval` flag(exec 天然无头),
需用 `-c approval_policy="never"`。

### C 验收

- [x] C1:`/mcp` 端点单测(auth/initialize/tools list/call/notification/batch 拒绝)+ 事件解析单测全绿
- [x] C2:**端到端冒烟通过**——真实 codex 连 /mcp,列出 4 工具并成功调用 book_structure
      (`cargo test --lib mcp_codex_live_smoke -- --ignored`,可重复执行)
- [x] C3:Rust 全量 192 单测通过(`cargo test --lib -- --test-threads=1`)
- [x] C4:AGENTS.md 铁律 #10(Codex 引擎硬边界)+ 文档地图已更新;两份 OpenCode 文档打 DEPRECATED 头
- [ ] C5(遗留):真机跑一次完整 Spark 解读 + 一页翻译(需要有书的库,建议 `pnpm dev:desktop` 验证)
- [ ] C6(遗留):AiWorkbench(agent-task)仍用前端 mock 回退,后续补 Rust 侧 codex 桥接命令
- [ ] C7(遗留):Spark 追问的会话续接可用 `codex exec resume <thread_id>` 优化(当前每轮独立,靠 prior_answer 传上下文,行为与 OpenCode 版一致)

---

## 阶段排期与检查点

| 阶段 | 内容 | 检查点 |
|---|---|---|
| 0 | 本计划文档 + docs 整理提交 | 用户 review 本文档,拍板 C 线路线(替换 vs 抽象+eval) |
| 1 | A1 keyring + A2 CI secret-scan | A 验收 checklist |
| 2 | B Obsidian v1 | B 验收 checklist |
| 3 | C1+C2 引擎抽象 + Codex spike | C1/C2 验收 |
| 4 | C3+C4 eval 与决策 + sidecar 打包 | C3/C4 验收,更新本文档为 [finish] |

> 排序理由:密钥是分发安全欠账,最先;Obsidian 是独立增量、无架构风险,放中间快速见效;引擎重构动核心文件,放最后且有 eval 兜底。

## 用户已拍板的决策(2026-07-07)

1. **C 线路线:直接整体替换为 Codex**(未采纳"抽象+eval"建议)。执行口径:Spark 与翻译迁到 `codex exec` 无头模式 + MCP book 工具;OpenCode 接线拆除;**Rust 进程内路径保留为回退链**(codex → rust → deterministic),这是降级兜底不是"第二引擎",不违背整体替换。
2. **Obsidian v1:每本书一个追加文件**。
3. **密钥(A1)本轮不做**:keyring 迁移与 key 轮换整体顺延,不阻塞本轮。

## 修订后排期

| 阶段 | 内容 | 检查点 |
|---|---|---|
| 0 | 本计划文档 + 决策落档 | ✅ 完成 |
| 1 | B 线 Obsidian v1 | ✅ 完成(遗留 B5 真机手工验证) |
| 2 | C 线 Codex 整体替换(Spark+翻译) | ✅ 完成(遗留 C5-C7) |
| 3 | 收尾:AGENTS.md/文档同步 | ✅ 完成;全量回归:Rust 192 + 前端 658 全绿,`pnpm build` 通过 |

**2026-07-07 收尾状态**:代码全部落地未提交(建议分两个 commit:docs 整理 housekeeping + 本轮 feat)。
剩余遗留:B5(Obsidian 真机手验)、C5(Spark/翻译真机整链路)、C6(AiWorkbench codex 桥接)、
C7(追问 resume 优化)、A 线密钥(用户决定顺延)。全部完成后本文档转 [finish]。
