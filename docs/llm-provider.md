# LLM Provider 多后端可配置设计

> 决策(用户确认):**引用统一用 chunk_id**(不依赖 Claude 原生 Citations);**MVP 默认 provider = DeepSeek**;三家(DeepSeek / OpenAI / Anthropic)做成运行时可切换。
> 已实测:DeepSeek `https://api.deepseek.com` 连通(当前默认 `deepseek-v4-flash`,OpenAI 兼容协议,带自有 prompt cache)。

---

## 1. 核心抽象

定义一个 `LlmProvider` trait(Rust 后端),所有 provider 实现它。前端只跟统一接口打交道,不感知具体厂商。

```
trait LlmProvider {
    // 普通/流式对话
    async fn chat(&self, req: ChatRequest) -> ChatResponse;
    async fn chat_stream(&self, req: ChatRequest) -> Stream<ChatDelta>;
    // 是否支持工具调用(agentic RAG 必需)
    fn supports_tools(&self) -> bool;
    fn capabilities(&self) -> Capabilities;  // 见 §4
}
```

`ChatRequest` 用**统一的中间表示**(messages + tools + 参数),各适配器负责翻译成厂商格式。

---

## 2. 三个适配器

| Provider | 协议 | 适配器 | 模型(规划/工具) |
|---|---|---|---|
| **DeepSeek** | OpenAI 兼容 | `OpenAiCompatProvider`(共用) | `deepseek-v4-flash`(规划+解读/工具) |
| **OpenAI** | OpenAI 原生 | `OpenAiCompatProvider`(共用) | `gpt-5.x`(规划)/ 便宜档(工具) |
| **Anthropic** | Messages API | `AnthropicProvider`(独立) | Opus(规划/解读)/ Haiku(工具) |

> **关键复用**:DeepSeek 和 OpenAI 都是 `/chat/completions` + `tools`(function calling)格式,**共用一个 `OpenAiCompatProvider`**,仅 `base_url` / `api_key` / `model` 不同。Anthropic 的 `/v1/messages` + `tool_use`/`tool_result` 块结构不同,单独写。

---

## 3. 配置(运行时可切换)

**配置项**(存 `.env` + 应用设置 UI,后者覆盖前者):
```
LLM_PROVIDER=deepseek            # deepseek | openai | anthropic
DEEPSEEK_API_KEY=... / DEEPSEEK_BASE_URL=https://api.deepseek.com
OPENAI_API_KEY=...  / OPENAI_BASE_URL=https://api.openai.com/v1
ANTHROPIC_API_KEY=...
ANTHROPIC_BASE_URL=https://api.anthropic.com
```

**Embedding 配置**:embedding 只走外部 provider,不在客户端本地部署/下载 embedding 模型。当前实现支持 OpenAI-compatible `/embeddings`:
```
EMBEDDING_PROVIDER=siliconflow    # disabled = 仅 FTS 文本检索
EMBEDDING_API_KEY=...
EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1/embeddings
EMBEDDING_MODEL=Qwen/Qwen3-Embedding-4B
EMBEDDING_DIM=2560              # 可选;配置后会校验 provider 返回维度
EMBEDDING_BATCH_SIZE=64         # 可选;provider 限流/超时时会自动减半重试
```
DB 存 `provider/model + dimension`;切换 provider 或模型必须重建整本索引,绝不混用向量。

**设置 UI**(接 `UI-UX.md`):设置页用 provider 预设按钮选择 DeepSeek / OpenAI / Anthropic,`Input`(密码态)填 key,高级模式可分别编辑每个 provider 的 `Base URL` 和 `Model`,`Button` 测试当前界面配置。切换 provider 时保留各自草稿和已保存配置;保存后即时生效。

**自定义接入规则**:
- DeepSeek / OpenAI 走 OpenAI-compatible Chat Completions,后端会把 `Base URL` 拼成 `{base_url}/chat/completions`。
- Anthropic 走 Messages API,后端会把 `Base URL` 拼成 `{base_url}/v1/messages`。
- `Base URL` 保存时去掉尾部 `/`;key 只写入本机 `.env`,不会写入 settings JSON。

**安全铁律**:当前 key 存本地后端 `.env`(Unix `0600`,Windows ACL 限当前用户),**经 Tauri Rust 后端调用,绝不进前端、绝不打包进客户端**(见 `AGENTS.md`)。商业分发应走自有服务端代理;系统钥匙串是后续加固项。

---

## 4. 能力差异(Capabilities)与降级

不同 provider 能力不同,用 `Capabilities` 显式声明,UI 据此降级而非报错:

| 能力 | DeepSeek | OpenAI | Anthropic |
|---|---|---|---|
| function calling / 工具(agentic RAG 必需) | ✅ | ✅ | ✅(tool_use) |
| 流式 | ✅ | ✅ | ✅ |
| prompt 缓存 | ✅ 自动(`prompt_cache_hit_tokens`) | ✅ 自动 | ✅ 显式 `cache_control` |
| 原生引用 Citations | ❌ | ❌ | ✅(V2 可选增强) |
| extended thinking | ❌ | 部分 | ✅ |

→ **统一最低基线 = function calling + 流式**,三家都满足,agentic RAG 在三家都能跑。

---

## 5. 引用策略:统一 chunk_id(已定)

**不依赖任何厂商的原生 Citations**,所有 provider 走同一套:

1. 检索返回的每个块带一个稳定 `chunk_id`(指向 SQLite 里的块 → 含 page_idx + 归一化 bbox)。
2. `search_book` 工具的返回里,每段证据前缀 `[chunk_id]`。
3. 系统提示要求模型:**解读中每个论断后用 `[chunk_id]` 标注依据**。
4. 我们后处理解读文本,把 `[chunk_id]` 解析成可点击引用 → 点击跳回书页高亮对应块。

**好处**:三家代码完全一致;引用可靠性由我们的提示工程 + 后处理保证,不被厂商能力绑架。
**V2 增强**:用 Anthropic 时,可选叠加其原生 Citations 提升精度(`capabilities.native_citations` 为真时启用),但不是必需。

---

## 6. agentic RAG 循环(provider 无关版)

对齐 `PLANNING.md` §5,但工具循环写成 provider 无关:

```
Plan(可选 thinking)→ 分解焦点段落为子问题
Loop(封顶 2–4 轮):
  模型 tool_call → search_book/get_chunk/get_neighbors/list_structure
  → 工具返回带 [chunk_id] 的证据 → 模型决定再检索 or 收尾
Synthesize → 带 [chunk_id] 引用的解读
```
- 工具调用的请求/响应翻译在适配器层完成(OpenAI `tool_calls` vs Anthropic `tool_use`)。
- 焦点段落每轮重钉(系统提示)。
- 缓存:OpenAI 兼容自动缓存,Anthropic 显式三断点缓存静态前缀。

---

## 7. 落地清单(Phase 3)

- [x] `ChatRequest`/`ChatResponse` provider-neutral 中间表示。
- [x] OpenAI-compatible provider(DeepSeek + OpenAI 共用)。
- [x] Anthropic Messages API provider。
- [x] provider 工厂:按 `LLM_PROVIDER` / 设置页实例化。
- [x] 工具调用在 OpenAI `tool_calls` 与 Anthropic `tool_use/tool_result` 间翻译。
- [x] chunk_id 引用的提示模板 + 后处理解析器。
- [x] 设置 UI:provider 选择 + key 输入 + 连通测试。
- [x] Embedding 设置 UI + 外部 provider `/embeddings` 连通测试。
- [ ] 真实 DeepSeek/OpenAI/Anthropic 三家在线回归仍需按当前密钥逐一跑。
- [ ] prompt cache usage 已在后端日志解析(OpenAI cached prompt tokens / Anthropic cache create/read tokens);产品内指标展示待做。
