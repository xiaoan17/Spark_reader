<p align="center">
  <img src="docs/assets/logo.png" alt="框选精读" width="120" />
</p>

<h1 align="center">框选精读</h1>

<p align="center">导入任意 PDF,框选任意段落,AI 以这段为锚点检索全书证据,给出带可点击引用的深度解读。</p>

---

## 这是什么

一个基于 Tauri + React 的桌面 PDF 精读应用。

和"和 PDF 聊天"类产品(把整篇塞进上下文做全局问答)不同:本产品把**框选段落**当作一等公民的意图入口——AI 以这段为焦点,主动 planning 并 agentic 检索全书证据,返回带可点击引用的深度解读,点击引用即可跳回原文高亮。

## 开箱即用(三步)

> 已下载打包好的安装包?直接安装运行,在应用内的「设置」里填入 API Key 即可,无需下面的开发环境。

从源码运行:

```bash
# 1. 安装依赖(需 Node.js 22+、pnpm、Rust stable)
pnpm install

# 2. 配置密钥:复制模板并填入你自己的 key
cp .env.example .env

# 3. 启动桌面应用
pnpm tauri dev
```

### 最少需要哪些 Key

| 用途 | 变量 | 获取入口 |
|---|---|---|
| **PDF 解析**(必填) | `MINERU_API_TOKEN` | [mineru.net/apiManage](https://mineru.net/apiManage/docs) |
| **AI 解读**(必填,默认 DeepSeek) | `DEEPSEEK_API_KEY` | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| **向量检索**(可选,可关闭) | `EMBEDDING_API_KEY` | [cloud.siliconflow.cn](https://cloud.siliconflow.cn/account/ak) |

只填 MinerU + 一个 LLM 的 key 就能用。LLM 可切换 OpenAI / Anthropic,embedding 留空时自动降级为本地全文检索。完整变量见 [`.env.example`](.env.example)。

> 🔒 `.env` 已被 `.gitignore` 忽略,所有密钥只在 Rust 后端读取,绝不进前端、绝不打包进客户端。

## 常用命令

```bash
pnpm tauri dev    # 桌面端开发(完整功能:密钥、MinerU 解析、Zotero 导入、本地文件)
pnpm dev          # 仅浏览器预览前端(界面走查、示例书;无密钥/云端能力)
pnpm storybook    # 组件走查
pnpm test         # 运行测试
pnpm secret-scan  # 推送前密钥扫描
```

## 从 Zotero 导入论文

桌面端顶部「从 Zotero 导入」可直接拉取本地 Zotero 文献库里的 PDF。需先打开 Zotero 桌面端、条目下有本地 PDF 附件,并用 `pnpm tauri dev` 启动。详见 [`docs/zotero-integration.md`](docs/zotero-integration.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | **架构设计与设计思路**(同伴上手第一读) |
| [`docs/tech-stack.md`](docs/tech-stack.md) | 完整技术栈 + 数据流 + 架构分层 |
| [`docs/coordinate-spec.md`](docs/coordinate-spec.md) | 坐标系统规范(头号 bug 来源) |
| [`docs/mineru-integration.md`](docs/mineru-integration.md) | MinerU API 集成(接口/坐标/配额/安全) |
| [`docs/llm-provider.md`](docs/llm-provider.md) | LLM 多 provider 设计(DeepSeek/OpenAI/Anthropic) |
| [`docs/zotero-integration.md`](docs/zotero-integration.md) | Zotero 本地导入 |
| [`ROADMAP.md`](ROADMAP.md) | 实现状态 + 分阶段任务 |

## 技术栈

| 层 | 选择 |
|---|---|
| 桌面框架 | Tauri v2(Rust 核心 + WebView) |
| 前端 | React 19 + TypeScript + Vite + Tailwind + shadcn/ui + zustand |
| PDF 渲染 + 框选 | pdf.js |
| PDF 解析 + 坐标 | MinerU API `api/v4` |
| 本地存储 | SQLite(`rusqlite`,bundled)+ FTS5 全文索引 + 向量表 |
| 检索 | SQLite FTS5 + 外部 provider 向量混合 |
| LLM | 多 provider:DeepSeek(默认)/ OpenAI / Anthropic |

### 关键设计

- **锚点:几何为真相,引用为桥。** 存几何 `ScaledPosition`(真相)+ `TextQuoteSelector`(模糊重定位),不依赖会漂移的 pdf.js 字符偏移。
- **坐标只有一个规范空间** = 归一化 PDF 页坐标(0..1);坐标真相 = MinerU `middle.json`。
- **引用统一用 chunk_id**:检索块带 `[chunk_id]` → 模型标注 → 后处理成可点击引用,三家 LLM 代码一致。
- **检索 = FTS5 + 向量混合**;provider 超时/失败时降级为纯 FTS,不阻断。
- **所有密钥只走 Rust 后端**,绝不进前端、绝不打包进客户端。
