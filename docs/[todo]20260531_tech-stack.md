# 技术栈(Tech Stack)

> 一句话:**Tauri v2(Rust 核心)+ React/TS/shadcn 前端 + pdf.js 渲染 + MinerU 解析 + SQLite 文本/向量索引 + 多 provider LLM 解读**
> 选型依据见 `_internal/[finish]20260531_PLANNING.md` §8 与经事实核查的风险表;MinerU 已端到端实测通过(见 `docs/[todo]20260531_mineru-integration.md`)。

---

## 完整技术栈

| 层 | 选择 | 关键库/版本约定 | 为什么 |
|---|---|---|---|
| 桌面框架 | **Tauri v2** | `@tauri-apps/cli`、`@tauri-apps/api` | 3–10MB 安装包、低内存、Rust 核心可向移动端复用 |
| 前端框架 | **React + TypeScript + Vite** | — | Tauri 前端;HMR 改完即看 |
| UI 组件 | **shadcn/ui + Tailwind CSS** | `components.json` | 组件名沟通省 token;纸感/夜读双主题 |
| 组件走查 | **Storybook** | — | 枚举全状态,防 AI 改坏组件 |
| 状态管理 | **Zustand** | — | 轻量集中 store(阅读状态/解读会话) |
| PDF 渲染+选择 | **pdf.js**(经 `react-pdf-highlighter-extended`) | 锁版本(锚点依赖其文本层) | 前端显示+框选;实测与 MinerU 坐标对齐 |
| PDF 解析+坐标 | **MinerU API `api/v4`** | token 经 `.env`→Rust 后端 | ✅ 验证通过,公式/表格/多栏/OCR + 坐标 |
| 后端/核心逻辑 | **Rust**(Tauri 后端) | `tokio`、`reqwest`、`serde` | 解析编排、坐标转换、检索、token 安全 |
| 本地数据库 | **SQLite**(`rusqlite`) | — | 书/高亮/锚点/解析缓存/解读历史 |
| 检索索引 | **SQLite FTS5** + provider 向量表 | `rusqlite`;向量存 provider/model/dim | 文本检索可离线;向量只来自外部 embedding provider;防混用;provider 超时/失败不阻断 FTS |
| Embedding | **外部 provider**(OpenAI-compatible `/embeddings`) | `.env` 后端读取: `EMBEDDING_*` | 用户提供 provider 数据;客户端不本地部署/下载 embedding 模型 |
| LLM 编排 | **多 provider 可配置**:DeepSeek(默认)/OpenAI/Anthropic | OpenAI 兼容适配器(DeepSeek+OpenAI 共用)+ Anthropic 独立;统一 chunk_id 引用 | 可切换;DeepSeek 已实测;详见 `docs/[todo]20260531_llm-provider.md` |
| 锚点 | `apache-annotator` + `diff-match-patch` | — | 几何为真相、引用为桥 |

---

## 数据流(一句话)

```
用户拖入 PDF
 → [Rust] 统一调用 MinerU API
 → [Rust] 拿到 middle.json:块 bbox(PDF points)+ page_size → 换算归一化页坐标;MinerU angle 非 0 时标记近似
 → [Rust] 切块 → FTS5 入库;若配置 EMBEDDING_PROVIDER,限时调用外部 embeddings API 后写入向量表
 → [前端 pdf.js] 渲染原版 PDF,用户框选 → 几何 ScaledPosition + 文本引用锚点
 → [前端→Rust→LLM] 框选段落为焦点 → agentic 循环(search_book 工具)→ 带 [chunk_id] 引用的解读
                              (LLM = DeepSeek 默认 / OpenAI / Anthropic 可切换)
 → [前端] 解读卡片 + 可点击引用跳回高亮;高亮/解读持久化到 SQLite
```

---

## 开发分工(异构 multi-agent)

| Agent | 负责 |
|---|---|
| **Codex (GPT)** | Rust 核心、MinerU 解析编排、**坐标转换**、agentic RAG 循环、找 bug 根因 |
| **Claude Code (Opus)** | React 前端组件、交互、UI 打磨、文档 |

详见 `AGENTS.md`。

---

## 待定/需 spike 确认的点

- [x] LLM 经 Rust 后端直连,token 不进前端；DeepSeek/OpenAI/Anthropic 适配器已有测试。
- [x] 外部 embedding provider 链路:写入向量、混合检索、provider/model/dim 防混用、provider 超时/失败后 FTS 降级。
- [ ] MinerU 云端旋转页/CropBox 边缘情况坐标回投(补真实样本验收)。
- [ ] 大 PDF(>500 页)性能、内存和长书分批体验。
