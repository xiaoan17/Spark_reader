# 核心债务收敛验收清单

## 自动化入口

- `pnpm health`: fmt、前端测试、中文 RAG eval、Rust lib 测试、前端 build、密钥扫描。
- `pnpm health:bundle`: 在 `pnpm health` 基础上构建 debug `.app`，并运行包内 `--product-self-check`。
- `pnpm eval:rag`: 小型中文 fixture，输出 baseline 与 query rewrite 后的 `recall@1/3/5`。

## 发布包白屏防线

1. 打开本次生成的目标 `.app`，不要只看构建日志或自检命令。
2. 用 Appshot / Computer Use / 窗口可访问树确认主界面真实出现。
3. 如果出现白屏，先看 `index.html` 的 `boot-diagnostics` 文案，再判断是资源加载失败还是 React runtime 崩溃。
4. 保留启动诊断；不要在没有错误信息时先猜缓存、路径或旧包。
5. React production minified error 先还原错误码；`#185` 优先排查 ref/effect/render 期间同步 `setState` 导致的最大更新深度。

## 真实窗口 E2E

1. 运行 `pnpm health:bundle`。
2. 打开 `src-tauri/target/debug/bundle/macos/框选精读.app`。
3. 导入 `0_book/财富公式.pdf`。
4. 搜索“复利 长期”，点击命中段落。
5. 运行深度解读，确认引用按钮能跳回原文。
6. 保存高亮和解读，关闭并重开应用，确认书籍、历史和高亮恢复。

记录项：导入耗时、搜索是否返回、引用跳转页码、历史恢复是否成功。

## MinerU 云端回归

运行：

```bash
python3 scripts/mineru_e2e.py "0_book/财富公式.pdf"
```

重点检查：

- token 只从 `.env` 或环境变量读取。
- 分批页码回写正确。
- `layout.json` / `middle.json` 的 `bbox / page_size` 归一化坐标在 `[0,1]` 内。
- 旋转页或 CropBox 近似坐标在 UI 中标注“近似”。

## 500+ 页 PDF 压测

建议用 `0_book/when china rules the world.pdf` 或其他 500+ 页 PDF：

1. 用 MinerU 导入，记录解析耗时、索引耗时。
2. 打开活动监视器记录峰值内存。
3. 搜索 3 个中文/英文关键词，确认 UI 可滚动、可搜索、可切换原 PDF 校对。
4. 记录 MinerU 输出目录大小和分批进度是否符合预期。

记录项：页数、PDF 大小、解析耗时、索引耗时、峰值内存、首次搜索耗时、UI 是否卡死。
