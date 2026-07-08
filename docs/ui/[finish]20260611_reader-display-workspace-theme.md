# 阅读外观工作区联动方案

## 背景

当前 `阅读外观` 已经能改变转换稿、TLDR、对照翻译的正文排版与正文背景，但顶栏、左侧目录、右侧 Spark 工作台仍使用全局应用主题。浅色主题下割裂不明显；切到 `Night` 时，中间阅读区变暗，左右面板和顶栏仍为白底，视觉上像三个独立应用拼在一起。

本方案把 `阅读外观` 从“正文主题”升级为“两层主题”：

1. **正文层**：继续参考 Typora theme 的字体、字号、行高、段落、标题、正文底色。
2. **工作区外框层**：顶栏、目录、右侧 Spark、分割线、浮层、选中态只跟随协调色，不接管控件排版。

## 目标

- 切换 `Newsprint`、`Night` 等阅读外观时，用户能一眼感到整个阅读工作区进入同一氛围，而不是只有正文变了。
- 保持 Spark 产品自己的控件语言：按钮、Tabs、设置表单、导入弹窗仍是 shadcn 风格，只改颜色与边界。
- 主题变量只作用于 `ReaderShell` 内部，不污染应用外其它页面，也不直接加载 Typora 原 CSS。
- 不影响 PDF 坐标、文本选择、引用回跳、Spark 锚点和对照翻译块对齐。

## 非目标

- 不做 macOS 原生标题栏换色。截图最顶部系统 titlebar 由 Tauri/系统控制，后续如果要改需要 custom titlebar 方案。
- 不把 Typora 的完整 CSS 全局注入。Typora CSS 有 `body`、`h1`、`table` 等全局选择器，直接加载会破坏按钮、侧栏和表单。
- 不让工作区外框使用正文衬线字体。外框仍用 UI 字体，避免目录和按钮变得像正文。
- 不在本阶段做用户自定义颜色编辑器；先提供固定预设。

## 主题模型

### 两组 token

`ReaderDisplayTheme` 保留正文 token，并新增工作区 token。

正文 token：

| Token | 用途 |
|---|---|
| `shellBg` | 正文滚动背景 |
| `surfaceBg` | 正文页面/分栏 surface |
| `text` / `muted` | 正文主文本/次文本 |
| `border` | 正文分割线、表格边框 |
| `link` / `quoteBorder` / `codeBg` | Markdown 元素 |
| `bodyFont` / `headingFont` | 只给正文 Markdown |
| `fontSize` / `lineHeight` / `pageWidth` | 正文阅读密度 |

新增工作区 token：

| Token | 用途 |
|---|---|
| `workspaceBg` | ReaderShell 主背景，承接顶栏和三栏之间的底色 |
| `chromeBg` / `chromeText` / `chromeMuted` | 顶栏、工具栏、图标文字 |
| `panelBg` / `panelText` / `panelMuted` | 左目录、右 Spark 面板 |
| `panelBorder` | 顶栏下边线、左右分隔线、Tabs 边线 |
| `panelHoverBg` | 目录项、图标按钮 hover |
| `panelActiveBg` / `panelActiveText` | 当前目录项、当前 Tab、AI ready 点附近强调 |
| `floatingBg` / `floatingText` / `floatingBorder` | 阅读外观菜单、toast、浮动工具条 |

### 预设策略

| 主题 | 正文层 | 工作区外框层 |
|---|---|---|
| `Spark 纸感` | 当前暖纸底、宋体正文 | 顶栏/目录/右栏为浅暖灰，主强调仍用品牌青绿 |
| `GitHub` | 白底、Open Sans 风格 | GitHub 式白灰面板、浅灰边框、蓝色链接 |
| `Newsprint` | 旧报纸窄栏、PT Serif 风格 | 暖灰纸面板、低对比边线，目录选中用低饱和青绿 |
| `Night` | 深灰蓝正文、浅灰文字 | 顶栏/目录/右栏同步深灰蓝，边框降低亮度，强调色用 Typora Night 蓝 |
| `Pixyll` | 博客长文、Merriweather/Lato 风格 | 白/浅灰外框，边线更清晰，避免外框抢正文 |
| `Gothic` | 几何无衬线、居中标题 | 接近白色外框，强调轻边框和精简 hover |
| `Whitey` | Palatino/Vollkorn 白纸风格 | 近白纸外框，目录选中保持温和 |

## 组件落点

### `ReaderShell`

- 把 `readerDisplayStyle` 从正文子组件上移到 ReaderShell 根节点。
- 根节点同时带：
  - `.reader-display-theme`：已有正文 token 默认值。
  - `.reader-workspace-theme`：新增工作区 token 默认值。
- 子组件不再重复挂 `style={readerDisplayStyle}`，除非是 portal 脱离 ReaderShell 的浮层。
- `notice` toast 使用 `floating*` token，避免 `Night` 下白色 toast 突兀。

### `ReaderTopBar`

- 顶栏背景、底边线、标题文字、图标默认/hover/active 都吃工作区 token。
- `阅读外观` 菜单使用 `floating*` token。
- `导入` 主按钮保留品牌主色，但需要在 `Night` 下检查对比度。
- 顶栏不使用正文 `bodyFont`，仍是 UI 字体。

### `ReaderSidebar`

- `aside` 背景、边框、标题、目录项文字使用 `panel*` token。
- 当前目录项使用 `panelActiveBg` / `panelActiveText`。
- hover 使用 `panelHoverBg`。
- 页码数字用 `panelMuted`，避免在 `Night` 下过亮。

### `AiWorkbench`

- 右侧整体背景、左边框、Tabs 下边线使用 `panel*` token。
- Spark/任务 Tab 激活态使用 `panelActive*` token。
- 空态、提示块、引用提示使用 `panelMuted` 和 `panelBorder`，但正文回答 Markdown 不套 Typora 正文字体。
- 任务列表和设置入口继续保留 shadcn 控件形态，只换面板色。

### 阅读正文组件

- `ConvertedTextReader`、`TldrReader`、`TranslationReader` 继续使用正文 token。
- 对照翻译左右分栏的中线使用 `border` 或 `panelBorder` 中更低对比的一项，避免 `Night` 下竖线过刺眼。
- PDF 原文校对视图不套正文主题。PDF 是原始版面与坐标校验入口，背景可跟随 `workspaceBg`，但 PDF 页本身保持原样。

## CSS 实现约束

- 工作区颜色用 CSS 变量直接表达完整颜色值，如 `#363b40` 或 `hsl(38 22% 91%)`。
- 不把这些变量塞进 shadcn 的 `--card` / `--muted` 等 HSL token，避免 `hsl(var(--card))` 遇到 hex 值失效。
- 增加 scoped class，而不是靠一长串 Tailwind 任意值：
  - `.reader-workspace-theme`
  - `.reader-chrome-bar`
  - `.reader-panel`
  - `.reader-panel-active`
  - `.reader-panel-muted`
  - `.reader-floating-surface`
- 新 class 只在 `src/styles.css` 的 `@layer components` 下定义。
- 字体仍然只在 `.reader-markdown`、`.reader-body-text`、`.reader-body-muted` 中使用。

## 实施步骤

1. 扩展 `src/components/reader/reader-display-theme.ts`
   - 给 `ReaderDisplayThemeVars` 增加工作区 token。
   - `readerDisplayThemeStyle()` 输出 `--reader-workspace-*` / `--reader-panel-*` / `--reader-floating-*`。
   - 更新单测覆盖 `Night` 和 `Newsprint` 的外框 token。

2. 调整 ReaderShell 变量挂载
   - ReaderShell 根节点挂 `reader-display-theme reader-workspace-theme` 和 `style={readerDisplayStyle}`。
   - 子阅读组件改为继承变量，减少重复传 style。
   - 空态导入页也能读取工作区底色。

3. 改顶栏、目录、右栏容器
   - `ReaderTopBar` header 改为 `.reader-chrome-bar`。
   - `ReaderSidebar` 根容器改为 `.reader-panel`，目录项加 active/hover token class。
   - `AiWorkbench` 根容器改为 `.reader-panel`，Tab active/empty state 同步 token。

4. 浮层和提示
   - `阅读外观` 菜单改为 `.reader-floating-surface`。
   - ReaderShell 顶部 notice 改为 `.reader-floating-surface`。
   - 选区浮条可先保留现状；若 `Night` 下刺眼，再单独接 `floating*` token。

5. 验证与截图
   - Storybook 或本地示例书检查 `Spark 纸感 / Newsprint / Night / Pixyll` 四个代表主题。
   - Browser 验证桌面宽屏和窄屏下没有文字溢出、面板分割线不刺眼。

## 验收标准

- `Night` 下：
  - 顶栏、左目录、右 Spark 面板不再是白底。
  - 当前目录项和 Spark Tab 仍清晰可辨。
  - 右侧空态说明文字对比度足够，不出现低亮灰字看不清。

- `Newsprint` 下：
  - 左右面板从纯白变为暖纸协调色。
  - 正文仍保持旧报纸窄栏和衬线风格。
  - 目录 hover/active 不破坏纸感。

- `GitHub / Pixyll / Whitey / Gothic` 下：
  - 工作区外框只轻微跟随，不喧宾夺主。
  - 顶栏按钮、导入按钮、设置入口仍像同一个产品。

- 技术回归：
  - `pnpm check:reader`
  - `pnpm check:quick`
  - `pnpm build`
  - 坐标相关测试不需要新增，但不能有回归。

## 风险与处理

| 风险 | 处理 |
|---|---|
| 外框过度主题化，像换了产品皮肤 | 外框只用色彩 token，不用 Typora 字体和标题规则 |
| `Night` 下按钮/输入对比不足 | 对 `Night` 单独调 `floating*`、`panelActive*`，不复用正文灰 |
| Tailwind 任意变量类构建不稳定 | 颜色类尽量集中进 CSS scoped class |
| 设置/导入弹窗是否跟随主题存在争议 | 第一阶段只保证 ReaderShell 内常驻三栏；弹窗可先保持产品主题 |
| PDF 校对视图被误主题化 | 明确 PDF 页和 text layer 不套正文 token，只允许外层背景协调 |

