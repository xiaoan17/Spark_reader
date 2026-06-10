# 微动效接入记录

> 记录 `Calligraph` 微动效的引入范围、修改点和后续使用边界。本文只覆盖短文本 / 数字反馈,不改变阅读正文、PDF 坐标或引用链路。

## 背景

参考的 `Calligraph` 是一个 React 文本与数字过渡库,适合用于 UI 状态短文案和计数变化。它不适合作为正文渲染层:正文涉及选区、Markdown 引用、PDF 回跳和阅读稳定性,字符级动效会放大交互风险。

## 依赖

- `calligraph@1.4.1`
- `motion@12.40.0`

两者都以精确版本写入 `package.json` / `pnpm-lock.yaml`,避免 peer dependency 浮动。

## 本次修改点

- 新增 `src/components/ui/animated-value.tsx`
  - 统一封装 `Calligraph`,业务组件不得直接散用第三方 API。
  - 仅接受 `string | number` 的短值,默认 `maxLength=40`。
  - `prefers-reduced-motion: reduce`、无 `matchMedia`、空字符串、超长文本时退回普通 `<span>`。
  - `Calligraph` 通过 lazy import 加载,首次渲染先用普通文本兜底,避免把 `motion` 直接并进首屏主包。
  - 关闭 `autoSize`,避免 `ResizeObserver` 引入测试环境不稳定,也减少计数变化造成的宽度动画。
- 新增 `src/components/ui/AnimatedValue.stories.tsx`
  - 覆盖短文本切换、数字切换和超长文本降级。
- 更新 `src/components/reader/AiWorkbench.tsx`
  - 任务 Tab 角标计数使用数字过渡。
- 更新 `src/components/reader/TasksPanel.tsx`
  - `运行中 N`、执行队列数量、任务完成步数、证据数量、知识线索数量使用数字过渡。
- 更新 `src/components/interpretation/InterpretationCard.tsx`
  - 解读可信度徽章里的接地 / 丢弃计数使用数字过渡。
- 更新 `src/components/reader/AiWorkbench.stories.tsx`
  - 增加 `TasksAnimatedCounts` story,用于检查任务计数与证据计数状态。

## 使用边界

可以使用:

- Badge 内的数字计数。
- 右栏工作台里的短状态文案。
- 任务进度、证据数量、线索数量等低频变化。

禁止使用:

- PDF text layer、转换稿正文、对照翻译正文。
- `MarkdownContent` 的正文内容和 LLM 流式正文。
- citation badge、chunk id 后处理、引用回跳、坐标校对、高亮矩形。

## 验收关注

- Storybook 中 `UI/AnimatedValue` 和 `Reader/AiWorkbench/TasksAnimatedCounts` 应能看到短文本 / 数字平滑变化。
- 系统开启减弱动态时应退回普通文本。
- 正文阅读区、PDF 坐标、引用点击行为不应有任何变化。
