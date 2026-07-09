# C9-spike · OpenCode 硬验证记录（2026-07-09）

> 目的：为"OpenCode 替换 Codex 成为默认 agent 引擎"提供 go/no-go 数据。
> 用本机 `~/.opencode/bin/opencode` **1.17.12** 硬验证四件事。
> 结论优先，均为实测证据。试验脚本/临时配置在 scratchpad；仓库仅新增本文件 + 一个 `#[ignore]` keepalive 测试。

## 四项结论摘要

| # | 验证项 | 结论 | 一句话 |
|---|---|---|---|
| 1 | 无头 JSON 事件 | **PARTIAL（run CLI FAIL / serve API PASS）** | `opencode run --format json` 本机**恒挂起零输出**；结构化事件只能经 `opencode serve` + HTTP/SSE 拿到 |
| 2 | 远程 MCP + Bearer | **FAIL（连接/鉴权 PASS，工具注册到模型 FAIL）** | Bearer header 支持、能连上我们的 `/mcp` 并 `tools/list` 全 4 工具；但工具**不会注册进模型 toolset**（复现 opencode 已知 bug #9425），本机 `type:local` stdio 亦未注入成功 |
| 3 | DeepSeek 自定义 baseURL 注入 | **PARTIAL（机制 PASS / 运行期路由未闭环）** | `options.baseURL` + `{env:KEY}` 能解析进 provider（`/config` 实证）；但内建 `deepseek` id 端点不可被覆盖、全新 provider id 报 `Model unavailable`，sandbox 内未能证明请求真打到我们指定的 baseURL |
| 4 | 配置隔离 + 工具锁死 | **PARTIAL（隔离有配方 / 工具锁 headless FAIL）** | `OPENCODE_CONFIG`/`OPENCODE_CONFIG_CONTENT` 都是**合并非替换**，唯一可靠隔离是把 `XDG_CONFIG_HOME` 指向空目录；`permission:{write:deny}` 在 serve+API 流里**没拦住** write（文件被写出） |

**GO/NO-GO：NO-GO（维持 Codex）**。opencode 1.17.12 在无头场景有三个硬阻断：`run` CLI 挂起、MCP 工具在无头流里不进模型 toolset（#9425）、`permission:deny` 在 serve+API 里未强制。Codex 现方案（`codex exec --json` 子进程 + 我们的 `/mcp` Bearer + `--sandbox read-only`）已闭环且干净，无理由现在切换。详见文末条件与复查清单。

---

## 环境

- opencode `1.17.12`（`~/.opencode/bin/opencode`），macOS 15/Darwin 25，Bun 运行时。
- 本机有 Clash Verge（TUN，198.18.0.0/15 fake-IP）在跑；验证期间另有一个无关的用户 `opencode run`（famou-master，PID 60221）在跑——**未触碰**，且其退出后 `run` 仍挂起，排除资源竞争。
- 未改动 `~/.config/opencode`、`~/.opencode` 用户配置。DeepSeek key 只经环境变量注入，从 `.env` 读，**未落任何提交文件**。

---

## 验证 1 · 无头 JSON 事件

**flag 存在**：`opencode run --format json`（`--help`：`--format ... [choices: "default","json"] [default:"default"]`）。

**实测 run CLI：FAIL（挂起零输出）**。多轮尝试，全部在 config 加载后停在 `message=init` 再无任何行（即便 `--log-level DEBUG`）：
- 自起服务模式、`--attach <已知可用 serve>` 模式都零输出；
- `--pure` + 全禁插件、独立 `OPENCODE_DB`、独立 XDG、free 模型、无竞争进程——**均挂起**；
- `sample` 抓栈：主线程在 `kevent64` 事件循环空等 I/O，非 CPU/安装忙，即 CLI 的 server↔client 自连流程死等。

**serve + HTTP/SSE：PASS（可拿全套结构化事件）**。`opencode serve` 正常起（`opencode server listening on http://127.0.0.1:<port>`），经 HTTP API 驱动一次真实 DeepSeek 轮次，SSE `GET /api/session/{id}/event` 事件序列（会话开始→助手文本→结束齐全）：

```
session.next.model.switched
session.next.prompt.admitted
session.next.prompted
session.next.step.started
session.next.reasoning.started
session.next.reasoning.ended
session.next.text.started
session.next.text.ended
session.next.step.ended
```

事件样例（每条含 `id`/`type`/`durable{aggregateID=sessionID,seq,version}`/`data`）：
```json
{"id":"evt_...","type":"session.next.text.started","durable":{"aggregateID":"ses_...","seq":7,"version":1},"data":{"timestamp":...}}
```
工具调用/文本/推理落在 message parts（`GET /api/session/{id}/message`），助手消息形如：
```json
{"type":"assistant","model":{"id":"deepseek-v4-flash","providerID":"deepseek"},
 "content":[{"type":"text","text":"2"}],"finish":"stop",
 "tokens":{"input":3139,"output":2,"reasoning":0,"cache":{"read":0,"write":0}}}
```
工具调用 part：`{"type":"tool","tool":"<name>","state":{"status":"completed","input":{...},"output":...}}`。

**接线含义**：若采用 opencode，**只能走 serve + HTTP API**（内嵌/常驻 server，用 `POST /api/session` → `POST /api/session/{id}/model`（ModelRef=`{id,providerID}`，注意是 `id` 不是 `modelID`）→ `POST /api/session/{id}/prompt`（body=`{"prompt":{"text":...}}`）→ SSE `/api/session/{id}/event`）。这比 Codex 的一次性 `codex exec --json` 子进程重得多。`run --format json` 本机不可用。

---

## 验证 2 · 远程 MCP + Bearer

**配置 schema（1.17.12，`https://opencode.ai/config.json`）**：remote MCP 字段 = `type:"remote"`、`url`、`enabled`、**`headers`（对象，可放 `Authorization: Bearer <token>`）**、`oauth`、`timeout`。**支持自定义 headers → Bearer 可行。**

**连接 + 鉴权：PASS**。用仿 `mcp_codex_live_smoke` 的 ignored 测试起真实 `book_tool_server`（Bearer token），opencode 配 `mcp.books={type:remote,url:http://127.0.0.1:<port>/mcp,headers:{Authorization:"Bearer ..."}}`。经日志代理抓到 opencode → 我们 `/mcp` 的**完整握手**：

```
POST /mcp initialize            → 200 (Authorization: Bearer ... 通过)
POST /mcp notifications/initialized → 202
GET  /mcp  (Accept: text/event-stream) → 405 method_not_allowed  ← 我们只实现 POST
POST /mcp tools/list            → 200，返回全部 4 个 book 工具及 schema
```
`GET /mcp` 的 SSE 监听通道我们返回 405；opencode 容忍它并继续 `tools/list` 成功。`GET /mcp status` 显示 `{"books":{"status":"connected"}}`。

**工具注册到模型：FAIL**。尽管 `tools/list` 成功返回 4 工具，**模型 toolset 里没有任何 book 工具**——多次让 DeepSeek「调用 book_structure」，它每次都枚举自己的工具，只有 14 个内建（bash/read/glob/... apply_patch），明确回「没有 book_structure」。这是 opencode 已确认 bug **#9425「Remote MCP type 显示 connected 但静默不注册工具」**（issue 中称 `type:local` stdio 可用作 workaround）。

**stdio workaround（`type:local`）：本机亦未成功注入**。按 #9425 建议试 `type:local` stdio MCP（opencode 确实 spawn 了子进程、`connected`），但在 serve+API 无头流里，模型 toolset 里**仍无** book_structure（free 模型实测同样「工具不可用」）。注：`GET /experimental/tool/ids` 只列 14 内建，是全局注册表、不含会话级 MCP 工具，不能当判据；判据是模型自述可用工具与是否真发生 `tools/call`——两者都为否。

**风险/替代**：即便修好 remote 注册，我们 `/mcp` 还需补 `GET /mcp` 的 SSE 通道（现 405）。Codex 走同一 `/mcp`（纯 JSON、无需 GET SSE）本就工作，此为 opencode 侧额外成本。

---

## 验证 3 · DeepSeek 自定义 baseURL 注入

**机制：PASS**。app 专属 opencode.json 里 `provider.deepseek.options={baseURL:"https://api.deepseek.com",apiKey:"{env:DEEPSEEK_API_KEY}"}`，`GET /config` 实证解析后 provider options 里 baseURL 与**注入的真实 key 值**都在（`{env:...}` 模板生效）。DeepSeek key 本身可用：直连 `curl https://api.deepseek.com/chat/completions` HTTP 200、回「2」。真实模型是 `deepseek-v4-flash`/`deepseek-v4-pro`（该端点 `/models` 只列这俩，`deepseek-chat` 不存在）。

**端到端：用内建 `deepseek` id 能出答案**。model=`deepseek/deepseek-v4-flash` 经 serve API 回「2」，助手消息 `model={id:deepseek-v4-flash,providerID:deepseek}`——请求确实到达 api.deepseek.com（DeepSeek 的 200 与限流「governor 401」都证明打到该 host）。

**运行期路由未闭环（PARTIAL 原因）**：
- provider id 用 `deepseek` 与 models.dev 内建**同名**→ 内建的 `api:https://api.deepseek.com` 赢，把 provider 级 `api`/`options.baseURL` 覆盖成代理都**不生效**（日志代理零命中），故无法区分「我的 baseURL」vs「内建 baseURL」（同 host）。
- 换**全新 provider id**（`dsx`）→ 运行轮次报 `ModelUnavailableError: Model unavailable`（`@ai-sdk/openai-compatible` 自定义 provider 在本 sandbox 未成功构造/装包），也就拿不到代理命中。
- DeepSeek key 对**带工具 schema 的较大请求**频繁「governor 401」限流（简单 1+1 能过），进一步拖慢验证。

**结论**：注入机制成立且有文档支撑；但「请求真打到我们指定的自定义 baseURL」在本机未取得干净证据。落地时须在联网真机上，用**不与内建同名**的 provider id 复验路由（并确保 `@ai-sdk/openai-compatible` 可装）。

---

## 验证 4 · 配置隔离 + 工具锁死

**配置加载顺序（DEBUG 日志实证）**：
```
$XDG_CONFIG_HOME/opencode/{config.json,opencode.json,opencode.jsonc}   ← 用户全局
$OPENCODE_CONFIG (自定义路径)
~/.opencode/{opencode.json,opencode.jsonc}                              ← 另一处全局，XDG 管不到
```

**隔离语义：合并（非替换）——重要**。在 `$XDG_CONFIG_HOME/opencode/opencode.json` 放毒（poison MCP + poisonprov provider + `bash:allow`），再经 `OPENCODE_CONFIG` 给干净 app 配置：`/config` 显示 **poison 的 provider/MCP 全泄漏进来**（`providers:[poisonprov,deepseek]`，`mcp:[poison,books]`）。`OPENCODE_CONFIG_CONTENT`（内联）**同样合并**、poison 仍泄漏。仅有我显式设的同名 key（如 `permission.bash`）会被我的值覆盖赢。

→ **唯一可靠隔离 = 把 `XDG_CONFIG_HOME` 指向一个空目录**（让全局无东西可合并）；并注意 `~/.opencode/opencode.json` 是**另一处全局**、不受 XDG 影响（本机恰好只有 `bin/`+`models.json`，为空才没泄漏，真机若用户建了此文件仍会并入——需额外处置，如把 `HOME` 也指向受控目录）。`OPENCODE_DISABLE_PROJECT_CONFIG=1` 可挡项目级 `./opencode.json`/`./.opencode/`。

**工具锁死：headless FAIL**。config 里 `permission:{bash:deny,edit:deny,write:deny,webfetch:deny,websearch:deny,read:deny,glob:deny,grep:deny,task:deny}`（`/config` 确认已加载）。诱导「用 write 工具建 pwned.txt」——**write 工具 status=completed、文件真被写出**。即 serve+API 无头流里 `permission:deny` **没有拦截工具执行**。（可能仅在 TUI/`run` 交互流强制，但 `run` 本机挂起、无法验证。）这对「屏蔽全部内建工具、只留我们的 MCP」是硬伤。

---

## 若仍要接线：推荐参数（当前不建议采用）

**配置模板**（app 专属 `opencode.json`）：
```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "<非内建同名 id>": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://api.deepseek.com", "apiKey": "{env:DEEPSEEK_API_KEY}" },
      "models": { "deepseek-v4-flash": {} }
    }
  },
  "model": "<id>/deepseek-v4-flash",
  "permission": { "bash": "deny", "edit": "deny", "write": "deny", "webfetch": "deny", "websearch": "deny" },
  "mcp": {
    "books": { "type": "local", "command": ["<stdio-bridge>"], "enabled": true }
  }
}
```

**环境变量（隔离必需）**：
```
XDG_CONFIG_HOME=<空的受控目录>        # 唯一可靠的全局隔离手段
OPENCODE_DISABLE_PROJECT_CONFIG=1     # 挡项目配置
OPENCODE_DISABLE_AUTOUPDATE=1
OPENCODE_DB=<会话独立 db>             # 避免与其它 opencode 实例 WAL 争用
DEEPSEEK_API_KEY=<经 keyring resolve_secret，绝不落盘>
# 还需处置 ~/.opencode/opencode.json（如设 HOME 到受控目录）
```

**命令**：只能走 `opencode serve --port <随机> --hostname 127.0.0.1`（常驻/内嵌），再经 `/api/session*` + SSE 驱动；**不要用 `opencode run --format json`（本机挂起）**。

---

## GO / NO-GO 与风险

**结论：NO-GO（现在维持 Codex 为默认引擎）。**

硬阻断（每条都直接砸掉"框选精读→Spark 深读"闭环）：
1. **`opencode run --format json` 挂起零输出**（本机、隔离、无竞争、free 模型均复现）。intended 无头路径不可用；只能自己抱一个常驻 server + HTTP/SSE，工程量远大于 Codex 子进程。
2. **MCP 工具无头下不进模型 toolset**：remote 是已确认 bug #9425，本机 `type:local` stdio 亦未注入成功。book 工具进不去 = Spark 的 agentic 检索无从谈起。
3. **`permission:deny` 无头下未强制**：诱导写文件成功。无法"锁死内建工具只留我们的 MCP"，与硬边界铁律冲突。
4. 隔离只能靠 `XDG_CONFIG_HOME` 空目录（合并语义），且 `~/.opencode` 是 XDG 管不到的第二全局，隔离面更脆。

对比：Codex 现方案 `codex exec --json` 子进程 + 我们 `/mcp`（Bearer、纯 JSON、无需 GET SSE）+ 显式 `--sandbox read-only`/`approval_policy=never`/整表替换 `mcp_servers` 已闭环且干净（AGENTS.md 铁律 10）。**没有现在切换的理由。**

**复查触发条件**（满足后再评估）：
- opencode #9425 修复 + 版本升级后，remote MCP 工具能进无头模型 toolset；
- `opencode run --format json` 无头挂起在本机定位/消失（或确认 serve+API 长期方案可接受）；
- serve+API 下 `permission:deny` 能真正拦工具；
- 自定义（非同名）provider 的 baseURL 路由在真机复验通过。

**次要风险备注**：DeepSeek key 对带工具的较大请求会 governor 限流；Clash TUN 环境可能干扰 opencode 自连（未定论）；`ModelRef` 用 `id` 非 `modelID`；`/api/*` 路由是权威、根路径部分命中会回 SPA 外壳（调试易踩坑）。

---

## Ignored 测试说明

新增 `src-tauri/src/book_tool_server.rs` 内 `#[ignore]` 测试 `opencode_remote_mcp_keepalive`（仿 `mcp_codex_live_smoke`）：起真实 book-tool `/mcp` server 并保活，打印 `SPIKE_MCP_ADDR`/`SPIKE_MCP_TOKEN`/`SPIKE_MCP_BOOK_ID`，供外部 opencode 连接验证。跑：
```
SPIKE_MCP_PORT=48191 SPIKE_MCP_TOKEN=opencode-spike-token SPIKE_MCP_KEEPALIVE_SECS=240 \
  cargo test --lib opencode_remote_mcp_keepalive -- --ignored --nocapture
```
非产品代码，纯验证脚手架；不影响正常构建（`cargo test --lib book_tool_server` = 17 passed / 2 ignored）。
