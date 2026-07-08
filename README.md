<p align="center">
  <img src="docs/assets/logo.png" alt="Spark 引读" width="120" />
</p>

<h1 align="center">Spark 引读</h1>

<p align="center">导入 PDF，框选文本，让 AI 围绕选区检索全书证据，并给出可回跳原文的解读。</p>

---

## 下载和安装

### macOS 内测安装包

1. 打开 [GitHub Releases](https://github.com/xiaoan17/Spark_reader/releases/latest)。
2. 下载最新的 `Spark_x.x.x_aarch64.dmg`。
3. 双击打开 DMG，把 **Spark** 拖进「应用程序」。

目前安装包仅支持 Apple Silicon，也就是 M 系列 Mac，系统要求 macOS 11+。

### 首次打开

当前 DMG 是**内测包**，使用临时签名，尚未做 Apple Developer ID 公证。macOS 首次打开时可能会提示无法验证开发者，这是预期现象。

推荐方式：

1. 打开「应用程序」。
2. 找到 **Spark**。
3. 右键点击 **Spark**，选择「打开」。
4. 在弹窗里再次点击「打开」。

如果仍然打不开，打开「终端」执行：

```bash
xattr -cr /Applications/Spark.app
```

然后再正常双击打开 **Spark**。

更完整的 macOS 安装说明见 [docs/[finish]20260603_INSTALL-macos.md](docs/[finish]20260603_INSTALL-macos.md)。

## 配置 API

安装包用户：首次启动后，打开应用内「设置」，填入自己的 API。

源码运行用户：也可以手动编辑仓库根目录的 `.env`。

| 用途 | 是否必需 | 配置项 | 获取入口 |
|---|---:|---|---|
| PDF 解析 | 必需 | `MINERU_API_TOKEN` | [MinerU API 管理](https://mineru.net/apiManage/token) |
| AI 解读/翻译 | 必需，默认 | `DEEPSEEK_API_KEY` | [DeepSeek API Keys](https://platform.deepseek.com/api_keys) |
| AI 解读/翻译 | 可替代 DeepSeek | `OPENAI_API_KEY` | [OpenAI API Keys](https://platform.openai.com/api-keys) |
| AI 解读/翻译 | 可替代 DeepSeek | `ANTHROPIC_API_KEY` | [Anthropic Console](https://console.anthropic.com/settings/keys) |
| 语义检索 | 可选 | `EMBEDDING_API_KEY` | [SiliconFlow API Keys](https://cloud.siliconflow.cn/account/ak) |

最小可用配置：**MinerU Token + 一个 LLM Key**。Embedding 不填也能使用，会自动降级为本地全文检索。

如果手动改 `.env`，切换 LLM 时同时设置 `LLM_PROVIDER=deepseek|openai|anthropic`。

密钥只保存在本机，只由 Tauri Rust 后端读取，不会进入前端代码，也不会打包进安装包。

## 发布内测包

维护者在本机运行：

```bash
pnpm release:dmg
```

脚本会生成 `releases/dmg-*/Spark_x.x.x_aarch64.dmg` 和对应 `.sha256`。把这两个文件上传到 GitHub Release，用户只需要下载 DMG 安装，不需要 Node、Rust、pnpm，也不需要从源码构建。

## 从源码运行

需要先安装 Node.js 22+、pnpm、Rust stable。

```bash
git clone https://github.com/xiaoan17/Spark_reader.git
cd Spark_reader
pnpm install
cp -n .env.example .env
pnpm dev:desktop
```

启动后可以直接在应用「设置」里填写 API，也可以手动编辑 `.env`。变量模板见 [.env.example](.env.example)。

常用命令：

```bash
pnpm dev:desktop  # 启动桌面开发版
pnpm check:reader # 阅读器快速回归
pnpm check:quick  # TypeScript + 全量前端测试
pnpm build        # 生产前端构建
pnpm release:dmg  # 本机打 macOS DMG
```

## 给其他 agent 的一句话

普通用户走 GitHub Releases 里的 `Spark_x.x.x_aarch64.dmg` 内测包，不要求用户构建；macOS 首次拦截时让用户右键 Spark 选择「打开」，仍被拦再执行 `xattr -cr /Applications/Spark.app`，启动后在「设置」里填 MinerU Token 和 DeepSeek/OpenAI/Anthropic 任一 LLM Key。

## 更多文档

- [finish] [docs/[finish]20260603_INSTALL-macos.md](docs/[finish]20260603_INSTALL-macos.md)：macOS 安装和首次打开
- [todo] [[todo]20260531_ROADMAP.md]([todo]20260531_ROADMAP.md)：路线图和剩余缺口
- [todo] [docs/[todo]20260603_architecture.md](docs/[todo]20260603_architecture.md)：架构设计
- [todo] [docs/[todo]20260531_tech-stack.md](docs/[todo]20260531_tech-stack.md)：技术栈
- [todo] [docs/[todo]20260531_mineru-integration.md](docs/[todo]20260531_mineru-integration.md)：MinerU 集成
- [todo] [docs/[todo]20260531_llm-provider.md](docs/[todo]20260531_llm-provider.md)：LLM provider 配置
