# TXT/EPUB 导入与阅读规范

## 目标

在现有 PDF/MinerU 转换稿阅读链路之外，补齐纯文本电子书导入能力：

- 支持 `.txt` 和 `.epub` 本地文件。
- 导入后写入同一套本机书库、FTS 索引、chunks、TLDR、对照翻译和解读入口。
- 不调用 MinerU，不消耗 MinerU 配额。

## 数据模型

当前书库字段仍沿用历史命名 `sourcePdfPath` / `originalPdfPath`。对 TXT/EPUB 这些字段表示“源文件路径”和“缓存的原始文件副本路径”，前端不要把它们解释为一定是 PDF。

纯文本书籍使用：

- `parserEngine`: `text-import-txt` 或 `text-import-epub`
- `coordinateMode`: `text-only`
- `rects`: 空数组

锚点仍以文本 quote 和 DOM 文本 offset 为主，几何坐标为空。引用、搜索和解读统一使用 `chunk_id`。

## 解析规则

TXT：

- 默认按 UTF-8 解码，支持 UTF-8 BOM。
- 规范换行和控制字符。
- 按空行分段；过长段落按字符窗口拆分。
- 每约 3500 字生成一个阅读页。

EPUB：

- 从 `META-INF/container.xml` 找 OPF。
- 读取 OPF `manifest`、`spine`、标题和目录项。
- 只处理 spine 中的 XHTML/HTML 文档，按阅读顺序合并。
- HTML 转成有限 Markdown：标题、段落、列表、blockquote、pre/code、图片 alt。
- 图片资源保留为描述文本，暂不复制 EPUB 内部图片到资产目录。

## 验收点

- 导入 TXT 后直接进入转换稿阅读视图，书架可重新打开。
- 导入 EPUB 后目录能从标题/章节生成，搜索和解读可命中正文。
- PDF 入口仍只走 MinerU，不受 TXT/EPUB 影响。
