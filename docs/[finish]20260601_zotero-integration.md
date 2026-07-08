# Zotero 本地导入集成

> 目标: 在桌面端顶部提供「从 Zotero 导入」入口。用户输入论文标题后,应用通过 Zotero 本地 API 找到条目和 PDF 附件,解析出本地 PDF 路径,再复用现有 PDF 导入/解析/索引管线。

## 边界

- Zotero 只作为文献库和 PDF 路径来源。
- PDF 解析、文本资产、chunk、引用、高亮和 AI 解读仍由本产品负责。
- 不上传 Zotero 元数据；标题搜索只访问 `127.0.0.1:23119`。
- 不直接修改 Zotero PDF。未来如需同步批注回 Zotero,必须显式触发,并继续经归一化 PDF 页坐标转换。

## 数据流

```
title query
  -> GET http://127.0.0.1:23119/api/users/0/items?q=...&qmode=titleCreatorYear
  -> filter regular items
  -> GET /api/users/0/items/{itemKey}/children
  -> find PDF attachment
  -> GET /api/users/0/items/{attachmentKey}/file
  -> read 302 Location: file://...
  -> import_zotero_item(item_key, page_count)
  -> MinerU parses the local PDF path
  -> get_converted_book(book_id)
  -> ReaderShell opens converted text workflow
```

## API

后端 Tauri commands:

- `search_zotero_items(query, limit)` -> `ZoteroSearchResult[]`
- `import_zotero_item(item_key, page_count)` -> `SaveBookResponse`

`search_zotero_items` 返回是否存在 PDF 附件,但不读取 PDF 文件内容。`import_zotero_item` 在后端解析 attachment 的 `file://` 路径后直接调用 MinerU 导入流程。

## 约束

- Zotero 桌面端必须运行,并开启本地 connector API。
- 支持 `imported_file` 和能通过 `/file` 返回本地 `file://` 的附件。
- 标题不唯一,UI 必须展示候选,由用户选择具体条目。
- 若本地书库已存在同源 PDF,复用现有缓存逻辑,不重复解析。
