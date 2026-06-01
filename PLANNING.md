# 框选精读 · 产品与技术规划

> 一句话定位:**像微信读书一样阅读任意 PDF,框选任意段落/句子,让 AI 以这段为锚点、主动检索全书证据,给你深度解读。**

> 文档版本:v1 · 2026-05-31
> 本规划基于一轮多智能体技术调研 + 对抗式验证,关键技术假设已做事实核查(见 §7 风险表中的「核查修正」标注)。

---

## 1. 产品定位与市场判断

### 1.1 核心洞察(你的原始痛点,提炼成产品语言)

现有"和 PDF 聊天"类产品(ChatPDF / Adobe AI Assistant / 各类全文问答)的范式是:**整篇喂进去 → 全局问答**。这个范式有两个根本缺陷:

1. **上下文稀释**:整本书塞进上下文,模型注意力被摊薄,对你真正关注的那一两句话理解很浅。
2. **丢失了"关注点"这个最强信号**:用户**框选**的动作本身就是一个极强的意图信号——它精确告诉 AI"我此刻的认知焦点在这里"。现有产品几乎都浪费了这个信号。

**我们的范式**:`框选(精准意图) → AI 规划(planning) → 全书检索证据(agentic retrieval) → 以选中段落为锚点的深度解读(grounded interpretation)`。

把**精准的人类意图**和**主动的机器检索**结合,这是现有产品没有做到的事,也是产品的护城河。

### 1.2 市场判断:有,且被低估

| 维度 | 判断 |
|---|---|
| 痛点真实性 | **高**。你和朋友独立感受到同一痛点("想用 AI 重读名著/精读论文,但只能整篇塞,对段落理解太浅"),且高频(每次阅读都会遇到)。 |
| 现有方案缺口 | 主流产品做"文档问答",**没有人把"框选段落"作为一等公民的意图入口**,更没有人在此之上做 agentic 全书检索。 |
| 技术风口契合 | agentic RAG 是当前的重要方向;"不是一次看完所有内容,而是边读边调整策略、主动找证据"正是这个范式的产品化。 |
| 相邻竞品 | 存在(见 §1.4),差异化必须锐利:**我们卖的不是"问答",是"精读陪伴"**。 |

### 1.3 目标用户(按优先级)

1. **重读经典的深度阅读者**(你本人画像):想用 AI 陪读名著、古诗词、散文,要的是"如果有人帮我解读会很不一样"的体验。
2. **精读论文的研究者/学生**:对其中一两句话有详细解读需求(定义、相关工作、推导、与上下文的关系)。
3. **泛读但想读透的知识工作者**:任意 PDF,选段即问。

### 1.4 与竞品的差异化(锐利的一句话)

- vs ChatPDF/全文问答:它们是"问文档",**我们是"选段精读"**——意图入口不同,检索策略不同。
- vs 微信读书:它有优秀的选段交互但**没有 agentic AI 解读**,且不支持任意 PDF。
- vs Adobe AI Assistant:它做摘要/问答,**不以选段为锚点做跨章节证据检索**。

我们 = **微信读书的选段交互体验 × agentic RAG 的深度解读**。

---

## 2. 你已确认的关键决策

| 决策点 | 你的选择 | 对架构的影响 |
|---|---|---|
| 核心场景 | 全场景(论文 / 古诗词短文 / 名著 / 通用 PDF) | PDF 解析需**分层路由**策略(见 §6) |
| agentic RAG | **核心卖点,必须有** | 这是护城河,不可砍;但 MVP 用收敛版本(见 §5) |
| 端的优先级 | **先 PC 本地 app**(macOS),后移动端 | Tauri v2 + 框架无关的 Rust 核心(见 §8) |
| AI 后端 | **调用云端 API**(Claude/GPT) | 书籍内容会发往云端;用 Claude 的 Citations + Prompt Caching |

---

## 3. 核心用户旅程(MVP)

```
1. 用户拖入一个 PDF
   → 应用解析:渲染原版 PDF + 后台抽取文本/坐标 + 切块 + 建本地索引(向量+全文)
2. 用户像微信读书一样阅读,用鼠标/手指框选一个段落或一句话
   → 浮出操作条:[深度解读] [它在说什么] [追问…]
3. 用户点"深度解读"(可附带自己的问题)
   → AI 以选中段落为不可动摇的焦点,planning 出若干子问题
   → 调用 search_book 工具,在全书范围检索相关段落(铺垫、定义、呼应、典故)
   → 迭代 2–4 轮:读 → 判断是否还需要更多证据 → 再检索
   → 产出带「引用」的解读:每个论断都能点回到书中确切段落
4. 解读以卡片形式停靠在选中段落旁;引用可点击跳转高亮
5. 高亮 + 解读持久化保存,下次打开仍在原位(靠几何锚点,见 §7)
```

---

## 4. 功能清单(MVP / V2)

### MVP(先做)
- [ ] 导入并渲染 PDF(pdf.js)
- [ ] 框选文本,浮出操作条
- [ ] **耐久的选区锚点**(几何 `ScaledPosition` + 文本引用 `TextQuoteSelector`,见 §7)
- [ ] MinerU 解析管线:`layout.json/middle.json` → 切块 → FTS5 索引;配置外部 embedding provider 后写入向量索引
- [ ] agentic 解读循环(收敛版:`search_book` / `get_chunk` / `list_structure` 三个工具,2–4 轮,带 Citations)
- [ ] 解读卡片 + 可点击引用跳转
- [ ] 高亮与解读的本地持久化
- [ ] 类型 2/3(名著/散文/古诗词)完整跑通——这是最干净、价值最高的路径
- [ ] 类型 4(扫描版)基础 OCR(尽力而为,UI 标注"近似")

### V2(后做)
- [ ] 复杂论文增强解析(marker / MinerU,公式 LaTeX、表格)
- [ ] 古诗词典故的外部知识检索 `search_external`(标注外部来源)
- [ ] 云端 OCR 兜底(Mistral OCR)
- [ ] 重排版双视图(像 EPUB 那样的舒适阅读流)
- [ ] 短书的"整本缓存单次解读"模式
- [ ] 移动端(见 §8)
- [ ] 跨页选区、结构化解读卡片

---

## 5. agentic RAG 循环设计(核心卖点)

**铁律:选中段落是不可动摇的焦点;AI 用工具主动检索全书,而不是把整本塞进去。**

```
[Plan 回合 · extended thinking]
  把焦点段落分解为子问题:定义? 相关工作? 铺垫? 人物弧光? 典故?
  系统提示里钉死:逐字的选中文本 + 它的 (章节, 位置)

[Retrieve · 工具调用 tool_choice:auto]
  search_book(query, scope)  — 混合检索:BM25(SQLite FTS5) + 外部 provider 向量
  get_chunk(id) / get_neighbors(id)  — 读取某块及其上下文
  list_structure()  — 目录 / 人物表
  search_external(query)  — [V2] 古诗词典故等书外知识,来源标注为"外部"

[Iterate · 按缺口驱动,封顶 2–4 轮]
  每次拿到 tool_result 后,用 extended thinking 决定:再检索 vs 出答案

[Synthesize 回合 · 强制 tool_choice:none]
  产出带引用的解读
```

**引用策略:统一 chunk_id(provider 无关,已定)**
- 检索返回的每个块带稳定 `chunk_id`(→ SQLite 块 → page_idx + 归一化 bbox)。
- `search_book` 返回的证据前缀 `[chunk_id]`;系统提示要求模型在每个论断后用 `[chunk_id]` 标注依据。
- 我们后处理把 `[chunk_id]` 解析成可点击引用 → 点击跳回书页高亮对应块。
- **三家 provider(DeepSeek/OpenAI/Anthropic)代码完全一致**,不依赖厂商原生 Citations。详见 `docs/llm-provider.md`。

**Prompt 缓存(各 provider 按能力):**
- DeepSeek/OpenAI:自动 prompt 缓存(命中看 `prompt_cache_hit_tokens`),把静态前缀(工具定义+系统提示+焦点段落)放在 messages 前部以提高命中。
- Anthropic:显式 `cache_control: ephemeral` 三断点缓存静态前缀。**绝不缓存整本书,绝不缓存 tool_results。**

**双模型分工(可选,按 provider):** 规划/最终解读用强模型,工具侧重排/摘要用便宜模型(Anthropic=Opus+Haiku;DeepSeek 单模型即可)。

**V2 增强:** 用 Anthropic 时可叠加原生 Citations(`content_block_location` + `cited_text`)提升引用精度,但非必需。⚠️ Anthropic 的 Citations 与 Structured Outputs 互斥(会 400)。

> **核查修正**:Prompt caching 让"重复整本塞"比"无缓存整本塞"便宜,但省的是缓存的钱、不是检索的钱;**高频/长书下,真正的 RAG(只检索相关块)依然更便宜**。所以主路径用 RAG;整本缓存单次解读仅留给短书(V2 优化)。

---

## 6. PDF 解析策略(MinerU 云端统一解析)

> **架构变更(用户已提供 MinerU 开放 API token)**:解析主引擎改为 **MinerU 精度版 API `api/v4`**——一个 API 覆盖四类内容(公式 LaTeX、表格 HTML、多栏、扫描 OCR),质量远高于自建本地解析+OCR。完整接口契约见 `docs/mineru-integration.md`(已核实官方文档,非猜测)。

**关键契合点**:MinerU 的 `middle.json` 每块带 `bbox`(PDF points)+ 每页 `page_size`,能直接换算进我们的"归一化 PDF 页坐标"规范空间——既做高质量解析,又供给框选锚点要的坐标。

**当前产品决策:桌面端统一走 MinerU**,不再保留 PyMuPDF/pypdf 本地解析兜底。浏览器预览里的 pdf.js 文本抽取只用于无后端界面走查,不作为桌面解析路径。

| 类型 | 是什么 | 策略 | 引擎 |
|---|---|---|---|
| **1 论文**(多栏/公式/表格) | 原生数字版,复杂版式 | **MinerU(`model_version=vlm`, `enable_formula/table=true`)**——公式转 LaTeX、表格转 HTML,块带 bbox+page_idx。这是 MinerU 最大价值所在。 | MinerU 云端 |
| **2 名著/散文**(干净可重排) | 原生数字版,简单 | 统一走 MinerU,保持解析/坐标/缓存管线一致。 | MinerU 云端 |
| **3 古诗词/短文 CJK** | 原生数字版,短篇 | 统一走 MinerU;**风险是字体不是语言**,检测乱码/U+FFFD 才需 OCR(走 MinerU `is_ocr=true`)。 | MinerU 云端 |
| **4 扫描版**(纯图像) | 无文本层 | **MinerU `is_ocr=true`**(`language` 按书设,109 语种含中文,返回真实页面坐标 bbox)。 | MinerU 云端 |

**解析流程(异步)**:本地文件 → `POST /api/v4/file-urls/batch` 取预签名链接 → `PUT` 上传 → 轮询 `GET /api/v4/extract-results/batch/{batch_id}` → 下载 `full_zip_url` 解压取 `middle.json`。详见 `docs/mineru-integration.md` §2。

**跨类型铁律:**
- **坐标真相来源 = MinerU `middle.json`(PDF points)**,经 `bbox / page_size` 换算到归一化页空间。⚠️ **原点方向(top-left? y 翻转?)、Rotate、CropBox 必须在 Phase 0 spike 经验验证**——文档只明确 vlm model.json 是 top-left,middle.json 未明示(见 §9 风险表)。
- **解析结果一次性缓存到本地 SQLite**,重开不重解析(省配额省延迟)。
- **>200 页的书用 `page_ranges` 分批提交**,前端拼接进度。
- **视觉 LLM(GPT-4o/Claude vision)只用于已解析文本的解释,绝不作为坐标来源**——会幻觉坐标。
- 重排版 markdown 会重排内容,**务必为每个块持久化原始 `page_idx`+`bbox`**,否则框选映射会静默失效。
- **Token 安全**:仅存 `.env`,经 Tauri Rust 后端调用,绝不进前端/不打包进客户端;商业分发应走自有服务端代理(见 `docs/mineru-integration.md` §7)。

---

## 7. 框选→源文本锚定(全产品最难、也最关键的一环)

> **核查修正(最重要的一条)**:`pdf.js` 的字符偏移量**不是**可靠的耐久锚点——文本项边界是启发式的,跨渲染/版本/参数会漂移;pdf.js 自己的高亮功能也不用偏移量,而是持久化**几何 QuadPoints**。同样,"任意 PDF 都能保留可靠的文本↔位置映射"也**不成立**(扫描版只能尽力而为)。

**核心原则:锚点钉在几何上,语义靠文本引用恢复,偏移量只当提示——永不作为真相来源。**

**捕获(在 pdf.js 渲染空间):**
1. 用户在透明文本层上拖框,DOM `Range` 覆盖若干 span。
2. 读 `range.getClientRects()`,转成**归一化 PDF 页坐标(0..1,带 pageNumber)**→ 得到 `ScaledPosition`(库:`react-pdf-highlighter-extended` 的 `viewportToScaled`)。
3. 记录 `selection.toString()` 作为引用文本。

**存储一个 W3C 选择器数组(三个都存,按此优先级):**
- **`ScaledPosition`(几何)** —— 规范的视觉高亮,与缩放/版本无关。**这是真相来源。**
- **`TextQuoteSelector { exact, prefix, suffix }`(文本引用,前后各约 32 字上下文)** —— 规范的**语义桥**,reparse 后靠它模糊重定位(库:`apache-annotator` 的 `describeTextQuote`)。
- **`TextPositionSelector { start, end }`** —— **仅提示**,且只有钉死 pdf.js 版本+`getTextContent` 参数时才有效。永不作真相。

**加载/重解析后重锚(Hypothesis 的"先定位再模糊匹配"模式):**
1. 用 `TextPositionSelector` 作提示定位候选区域。
2. 断言 `TextQuoteSelector.exact` 在那里匹配。
3. 不匹配 → 用 `diff-match-patch` 模糊搜索引用文本(库:`dom-anchor-text-quote`),按页偏置。
4. 由命中的 range 重建高亮矩形;若文本层漂移导致不完美,回退到 `ScaledPosition` 几何来画高亮。

**桥接到 RAG:** 入库时建每页 `offset → chunk` 映射(先归一化空白)。重锚得到字符范围后,**按重叠(而非 offset==边界)查找命中的块**,喂给 agent。

**坐标纪律(双方调研都点名为头号 bug 来源):**
- 钉死**唯一规范空间 = 归一化 PDF 页坐标**。为以下都写显式转换:PDF 左下原点 vs pdf.js/MinerU 左上原点、MinerU 的 0–1000 归一化、`/Rotate`、`CropBox` vs `MediaBox`、缩放/DPI。
- **每个关注点只用一个引擎**:pdf.js 管显示+选择,MinerU 管解析+坐标。交汇处(高亮增强块)经规范空间转换。

**边界情况:** 跨页选区 → 每页矩形列表 + 每页引用片段(多 target);重复样式文字(页眉页脚)→ 长前后缀 + 页偏置避免错锚;扫描版无文本层 → OCR 前无法选择,OCR 框是尽力而为,**UI 必须标注"近似"**。

---

## 8. 推荐技术栈

| 层 | 选择 | 一句话理由 |
|---|---|---|
| **桌面框架** | **Tauri v2**(TS/React 前端 + Rust 核心) | 安装包 3–10MB、内存约 Electron 的 1/3;Rust 核心可向移动端交叉编译;阅读类负载不需要打包 Chromium。 |
| **PDF 渲染+坐标真相** | **pdf.js** 管显示/选择;**MinerU API** 管解析+坐标(`middle.json` bbox) | 用户看到/选择的归 pdf.js;高质量解析+坐标归 MinerU。 |
| **文本锚定** | W3C 选择器数组:几何 `ScaledPosition`(真相)+ `TextQuoteSelector`(语义桥)+ `TextPositionSelector`(仅提示) | 见 §7。 |
| **本地索引** | **SQLite FTS5** + provider 向量表(后续可换 sqlite-vec 加速) | 纯文本检索始终可用;向量只存外部 provider 产物,不在客户端本地部署 embedding 模型。 |
| **Embedding** | **外部 provider**(OpenAI-compatible `/embeddings`) | 用户提供 provider 数据;DB 存 provider/model+维度,切换即整本重嵌,**绝不混用**。 |
| **LLM 编排** | **多 provider 可配置**:DeepSeek(默认)/ OpenAI / Anthropic,统一抽象层;agentic 工具循环 | DeepSeek 现成、便宜、中文好、已实测;OpenAI/DeepSeek 共用兼容适配器,Anthropic 独立;**引用统一用 chunk_id**(不绑厂商 Citations)。详见 `docs/llm-provider.md`。 |

### PC-now / Mobile-later 路径
- **现在(PC)**:Tauri v2 + TS/React。**把 RAG/解析/检索管线写成框架无关的 Rust 核心**(`rusqlite`/FTS5、外部 embedding provider、MinerU 编排),经 `uniffi`/FFI 复用。
- **以后(移动)——共享核心 + 薄壳,不是"Tauri 一统天下"**:
  > **核查修正**:Tauri v2 移动端是 **GA(2024-10)、真实可用、非画饼**——但有坑:`updater` 插件仅桌面(无 OTA,只能商店更新)、多个插件仅桌面、WebView 碎片化(WKWebView vs 各家安卓 WebView)带来真实 QA 成本。
  - 因为本 app 是内容/UI 驱动、无桌面专属插件硬依赖,**Tauri v2 移动端确实可选**;但对个人/小团队,更稳的是 **React Native/Expo 薄壳复用 Rust 核心**(`op-sqlite`/`expo-sqlite` 上 sqlite-vec)。
  - 无论哪条,**只共享核心逻辑,UI 壳各做各的**。
- **下注移动端前先做真机 spike**:多台安卓 OEM/WebView 版本 + iOS,验证 sqlite-vec 扩展能否在设备上加载、SSE/`ReadableStream` 流式是否需要 polyfill。

---

## 9. Top 技术风险与缓解

| # | 风险 | 缓解/兜底 |
|---|---|---|
| 1 | 耐久锚点在重解析/版本变更后失效(核查:偏移量不耐久,几何才耐久) | 几何 `ScaledPosition` 为真相;引用 + `diff-match-patch` 模糊匹配恢复语义;偏移量仅提示。每版书索引带版本号;存 pdf.js 版本+参数,变了就作废偏移提示。 |
| 2 | 跨引擎坐标空间不匹配(原点翻转、旋转、**MinerU bbox vs page_size vs pdf.js viewport**、DPI) | 唯一规范归一化页空间;**Phase 0 必做坐标回投 spike**:MinerU bbox 经 `bbox/page_size` 换算后画回 pdf.js 页,肉眼验证原点方向/Rotate/CropBox(文档只明确 vlm model.json 是 top-left,middle.json 未明示);每引擎写显式转换 + 单测。 |
| 3 | 扫描/任意 PDF 给不出可靠文本↔位置映射(核查:只能尽力而为) | OCRmyPDF `--deskew --clean` 预处理;OCR 框按置信度阈值当尽力而为;UI 标注扫描锚点为近似;难扫描走云端 Mistral OCR。 |
| 4 | agent 循环里焦点漂移 + 缓存未命中 + 典故幻觉 | 每轮重钉逐字选中文本("解读**这段**,检索内容仅为佐证");只缓存静态前缀;封顶 2–4 轮按缺口停;典故走 `search_external` 并标注来源;warm 缓存避免重复写。 |
| 5 | 1.0 前外部依赖 churn(LLM/embedding provider 接口、MinerU API)+ MinerU 授权 | 锁精确版本/模型名 + 升级测试计划;向量走外部 provider 暴力检索(<1 万向量足够),不引入本地向量库;**确认 MinerU 商用授权条款**。 |
| 6 | **MinerU 依赖外部服务**:异步分钟级延迟、1000 页/天配额、内容上云(隐私)、token 暴露/过期 | 解析结果一次性缓存本地 SQLite(不重解析);长书 `page_ranges` 分批 + 进度可视;临近配额提示;token 仅存 `.env` 经 Rust 后端调用、商业分发走自有服务端代理;监控 token `exp`。 |

---

## 10. 一句话总结给你

这个产品**有真实市场、踩中技术风口、且差异化清晰**。最大的工程难点不是 AI(Claude 的 Citations+工具循环已成熟),而是**框选锚点的耐久性**——而调研已经给出了确定的解法:**几何为真相、引用为桥、偏移仅提示**。MVP 聚焦在你最想要的"名著/古诗词/散文重读",这恰好是技术上最干净的路径,可以最快做出能打动你自己的版本。

下一份文档 `ROADMAP.md` 把这一切拆成可执行的分阶段任务。
