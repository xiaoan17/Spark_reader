# 技术栈(Tech Stack)

> 一句话:**Tauri v2(Rust 核心)+ React/TS/shadcn 前端 + pdf.js 渲染 + MinerU 解析 + SQLite 文本/向量索引 + Codex Agent 引擎(由多 provider LLM 驱动)**
> 选型依据见 `_internal/[finish]20260531_PLANNING.md` §8 与经事实核查的风险表;MinerU 已端到端实测通过(见 `docs/[todo]20260531_mineru-integration.md`)。

---

## 完整技术栈

| 层 | 选择 | 关键库/版本约定 | 为什么 |
|---|---|---|---|
| 桌面框架 | **Tauri v2** | `tauri =2.11.2`、`@tauri-apps/api 2.11.0`、`@tauri-apps/cli 2.11.2` | 3–10MB 安装包、低内存、Rust 核心可向移动端复用 |
| 前端框架 | **React + TypeScript + Vite** | `react 19.2.6`、`vite 8.0.14`、`typescript 6.0.3` | Tauri 前端;HMR 改完即看 |
| UI 组件 | **shadcn/ui + Tailwind CSS** | `components.json`、`tailwindcss 3.4.17` | 组件名沟通省 token;纸感/夜读双主题 |
| 微动效 | **calligraph** | `calligraph 1.4.1` | 克制的阅读动效(见 `docs/ui/[finish]20260610_micro-animations.md`) |
| 组件走查 | **Storybook** | `storybook 8.6.17` | 枚举全状态,防 AI 改坏组件 |
| 前端测试 | **vitest** | `vitest 4.1.0` + `jsdom` | 端无关核心逻辑全单测 |
| 状态管理 | **Zustand** | `zustand 5.0.2` | 轻量集中 store(阅读状态/解读会话) |
| PDF 渲染+选择 | **pdf.js** | `pdfjs-dist 6.0.227` 锁版本(锚点依赖其文本层) | 前端显示+框选;实测与 MinerU 坐标对齐 |
| PDF 解析+坐标 | **MinerU API `api/v4`** | token 经 `.env`→Rust 后端 | ✅ 验证通过,公式/表格/多栏/OCR + 坐标 |
| 后端/核心逻辑 | **Rust**(Tauri 后端) | `tokio =1.42.0`、`reqwest =0.12.11`、`serde =1.0.225` | 解析编排、坐标转换、检索、token 安全 |
| 本地数据库 | **SQLite**(`rusqlite`) | `rusqlite =0.32.1`(bundled) | 书/高亮/锚点/解析缓存/解读历史/知识层 |
| 检索索引 | **SQLite FTS5** + provider 向量表 | `rusqlite`;向量存 provider/model/dim | 文本检索可离线;向量只来自外部 embedding provider;防混用;provider 超时/失败不阻断 FTS |
| Embedding | **外部 provider**(OpenAI-compatible `/embeddings`) | `.env` 后端读取: `EMBEDDING_*` | 用户提供 provider 数据;客户端不本地部署/下载 embedding 模型 |
| LLM 编排 | **多 provider 可配置**:DeepSeek(默认)/OpenAI/Anthropic | OpenAI 兼容适配器(DeepSeek+OpenAI 共用)+ Anthropic 独立;统一 chunk_id 引用;默认模型 `deepseek-v4-flash` | 可切换;DeepSeek 已实测;详见 `docs/[todo]20260531_llm-provider.md` |
| **Agent 引擎** | **Codex**(2026-07 起,OpenCode 方案已废弃) | per-request `codex exec --json` 子进程,显式 `--sandbox read-only` + `approval_policy="never"` + `mcp_servers` 整表替换;book 工具走 `book_tool_server.rs` `/mcp` 端点(Bearer 鉴权,仅 127.0.0.1);`responses_bridge.rs` 让 app 配置的 LLM 驱动 codex | Spark/翻译/TLDR 统一引擎;失败自动回退 Rust 进程内管线,`FOCUSED_READING_CODEX_DISABLED=1` 强制回退 |
| 密钥存储 | **本地文件默认(Unix 0600),keychain opt-in** | `config/secret_store.rs`;`FOCUSED_READING_SECRET_BACKEND=keychain` 切换;`keyring =3.6.3` | 密钥只存本地、只经 Rust 后端读取,绝不进前端 |
| 缓存 | **reuse-first 缓存层** | `storage/mod.rs`:翻译/TLDR/embeddings/trace 结果复用优先 | 不重复消耗 MinerU/LLM/embedding 配额 |
| Obsidian 导出 | **本地 vault 追加写** | `obsidian.rs`(原子写、路径逃逸防护)+ 前端 `ObsidianSettingsPanel` | 高亮/Spark 卡片/知识面板三入口,数据不出本机 |
| 锚点 | 自研 `src/core/text-quote-selector.ts` | 几何 ScaledPosition + TextQuote 模糊重定位 | 几何为真相、引用为桥;`apache-annotator`/`diff-match-patch` 依赖已移除 |
| 发布 | **`scripts/release_dmg.sh`** | 已发到 0.1.8(14 个本地 dmg);签名/公证未做 | 一键出 dmg |

---

## 数据流(一句话)

```
用户拖入 PDF
 → [Rust] 统一调用 MinerU API
 → [Rust] 拿到 middle.json:块 bbox(PDF points)+ page_size → 换算归一化页坐标;MinerU angle 非 0 时标记近似
 → [Rust] 切块 → FTS5 入库;若配置 EMBEDDING_PROVIDER,限时调用外部 embeddings API 后写入向量表
 → [前端 pdf.js] 渲染原版 PDF,用户框选 → 几何 ScaledPosition + 文本引用锚点
 → [前端→Rust→Codex 引擎] 框选段落为焦点 → `codex exec` 子进程跑 agentic 循环(book 工具走本地 /mcp)
                              (codex 由 app 配置的 LLM 驱动:DeepSeek 默认 / OpenAI / Anthropic;失败回退 Rust 进程内管线)
 → [前端] 解读卡片 + 可点击引用跳回高亮;高亮/解读持久化到 SQLite;翻译/TLDR/embedding 结果走 reuse-first 缓存
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
