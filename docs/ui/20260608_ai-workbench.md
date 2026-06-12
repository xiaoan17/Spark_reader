# AI 工作台 · 右栏重构 Spec

> 目标:把现在「靠一个布尔在 SparkPanel / InterpretationCard 之间切换」的右栏,重构成一个**上下文驱动的 AI 工作台**——统一收编解读 / 陪读 / 追问 / 知识 / Agent 长任务,让 AI 围绕「用户正在读的这一段」工作,而不是站在右边当结果列表。
> 基准:`20260603_BRAND.md`(阅读优先、AI 退居其次、框选是第一动作、AI 思考可感知)、`20260531_UI-UX.md`(热路径、三栏布局、§7 纯展示组件)、`docs/ui/20260608_UI改造清单.md`。
> 范围:本轮**只产出 spec,不动代码**。决策已确认:① OpenCode 以**嵌入式 agent 终端**进入;② 右栏**保持常驻**(不做默认收起),只重构内容。

---

## 1. 现状盘点(写 spec 前的代码事实)

| 位置 | 现状 | 问题 |
|---|---|---|
| `ReaderInterpretationAside.tsx` | `sparkPanelOpen ? <SparkPanel> : <InterpretationCard>` 二选一,固定占 360px | 一个布尔切换两套**职责高度重叠**的 AI 对话面板,用户分不清何时用哪个 |
| `SparkPanel.tsx` | 选区 + spark/note 双模式 + 多轮追问 + 历史 | 「轻量陪读 + 追问」 |
| `InterpretationCard.tsx` | phase + evidence + agentTrace + 解读正文 + followUps + 追问 | 「深度解读 + 追问」——与 SparkPanel 的追问重复 |
| `KnowledgePanel`(knowledge view) | 顶栏**平级全屏视图**,`showsInterpretationAside: false` | 与右栏割裂;知识资产和当前阅读上下文断开 |
| OpenCode | **代码零引用,尚未接入** | 一旦接入会成为**第三个对话入口**,继续稀释 |

**结论**:右栏现在不是「太丑」,而是**承载了两个抢同一职责的弱面板**。重构的本质 = 用一套状态机收编它们,并为 Agent 终端、知识层划清边界。

---

## 2. 设计原则(约束这次所有决策)

1. **AI 是当前阅读上下文的副驾,不是常驻聊天框。** 右栏永远先回答「你正在读的这一段」,不是一个通用 ChatGPT。
2. **一个上下文,一套对话。** 同一选区下,解读 / 追问 / 陪读不应该是两个面板,而是**同一条线程的不同深度**。
3. **用户不关心后端是谁。** 解读 / Spark / OpenCode / 知识体系不应在顶栏平级铺开。用户只关心三件事:**帮我理解、帮我整理、帮我留下来**。
4. **Agent(OpenCode)= 干「跨段落 / 跨全书 / 多步」的活**,解读 = 干「就这一段」的活。**用边界区分,不是用入口区分。**
5. **保持常驻,但分层。** 右栏不收起,但默认安静:无选区时显示「知识 / 最近」,有选区时升起「当前」。

---

## 3. 新结构:三区单栏工作台

右栏仍是常驻的一列(沿用 `360px`,见 §7 布局),但内部从「二选一面板」变成**三个 Tab 区**:

```
┌─ AI 工作台 (常驻 360px) ───────────┐
│  [ 当前 ]  [ 任务 ]                  │  ← Tab 切换,任务区带进行中角标
├────────────────────────────────────┤
│                                      │
│   << 区块内容,见 §4 / §5 >>          │
│                                      │
└────────────────────────────────────┘
```

> **决策(2026-06-07):知识 Tab 不做。** 知识沉淀是后台行为,用户不主动感知——知识体系保留为顶栏的全屏视图,**不**进右栏。右栏工作台只有「当前」+「任务」两区。本文 §6 的知识区设计作废,保留仅作历史记录。

### Tab 含义(对应原则 3 的「理解 / 整理」)

| Tab | 回答的问题 | 收编了谁 | 默认激活条件 |
|---|---|---|---|
| **当前** | 「帮我理解这一段」 | SparkPanel + InterpretationCard(合并成一条线程) | 有选区 / 刚触发解读时自动切到这里 |
| **任务** | 「帮我整理 / 跑个长活」 | OpenCode agent 终端 + TLDR/章节整理/知识图谱构建等长任务 | 有任务在跑时角标提示;手动切入 |

> 角标规则:**任务**区有 running 任务 → Tab 显示转圈数字。Tab 不抢焦点,只提示。
> 知识沉淀(高亮/笔记/Agent 产物 → kb_cards)仍在后台进行,但入口只在顶栏知识体系视图,右栏不暴露。

---

## 4. 「当前」区:统一解读线程(收编 Spark + InterpretationCard)

这是重构的核心。**取消 `sparkPanelOpen` 这个二选一布尔**,改成一条「证据驱动的解读线程」:

```
┌─ 当前 ──────────────────────────────┐
│ ▸ 选区:复利是世界第八大奇迹…(可折叠)  │  ← 顶部锚定当前选区,点击回跳原文
├────────────────────────────────────┤
│ ◇ AI 正在查找:〔什么是复利〕〔前文出处〕 │  ← planning/retrieving 阶段(§4.2)
│   命中证据:第1页·复利那段  第3页·利率   │  ← 可点回跳的人类标签(非裸 chunkId)
├────────────────────────────────────┤
│ 解读正文(streaming)…                  │
│   …可回跳引用 ¹ ² ³                    │
├────────────────────────────────────┤
│ ↳ 追问:那通胀怎么算?                   │  ← 同一线程往下接,不是另开面板
│   答…                                  │
├────────────────────────────────────┤
│ [继续追问___________] [发送]            │
│ [复制] [保存为笔记] [沉淀为知识卡] [重解读]│  ← 底部动作条
└────────────────────────────────────┘
```

### 4.1 「解读」与「Spark/陪读」如何合并

二者本质都是「对选区的 AI 回答 + 多轮追问」。合并为**一条线程,两种深度**:

- **首轮**:框选 → 点「解读」→ 走 agentic 检索(planning → retrieving → streaming),产出带引用的深度解读 = 原 InterpretationCard 的能力。
- **追问**:在同一线程底部继续问 = 原 SparkPanel 的多轮陪读。**不再有独立的 Spark 面板**。
- **轻量模式**:原 SparkPanel「留空则生成轻量解释」保留为一个开关(线程顶部 `深度 ⇆ 轻量` toggle),轻量 = 跳过检索、直接 LLM 解释。
- **Note**:原 SparkPanel 的 note 模式 → 归入「保存为笔记」动作,写入「知识」区,不再占一个 mode tab。

> 迁移收益:用户从「我该开 Spark 还是看解读卡?」变成「框选 → 解读 → 往下追问」一条直路,符合 BRAND「框选是第一动作 / 2 步触达」。

### 4.2 AI 思考过程可感知(BRAND 原则 5 + 清单 #4)

planning/retrieving 阶段透出**差异化子问题 + 命中章节标题**(不是三个「相关段落」占位)。沿用 `AgentTraceStep` / `EvidencePreview`,但 chip label 走 `evidenceLabel`(清单 #3/#4 已规划的人类标签),禁止裸 `chunk_id`。

---

## 5. 「任务」区:OpenCode agent 终端 + 长任务(核心新增)

这是 OpenCode 的落点。**关键设计:Agent 终端不是「第二个聊天框」,而是「长任务的驾驶舱」。**

### 5.1 职责边界(怎么让它不和「当前/解读」打架)

| | 「当前」区(解读) | 「任务」区(Agent / OpenCode) |
|---|---|---|
| 作用域 | **就这一段选区** | **跨段落 / 整章 / 整书** |
| 时长 | 秒级,即时流式 | 几十秒到分钟级,可后台 |
| 交互 | 追问式对话 | 下达任务 → 看 plan/进度 → 收产物 |
| 产物 | 解读文本 + 引用 | 结构化产物(大纲 / 概念表 / 知识册 / 矛盾报告)+ 引用 |
| 触发 | 框选浮条「解读」 | 任务区指令 / 命令面板 / 「沉淀全书高亮」等动作 |

> 一句话:**问一段用「当前」,办一件事用「任务」。** 这条边界让两者不重叠。

### 5.2 任务区结构

```
┌─ 任务 ──────────────────────────────┐
│ [指令输入:整理本章论证结构…] [▶ 运行]   │  ← 可选自由指令 + 预设任务
│ 预设:整理本章 / 找反复概念 / 全书高亮成册 │
│       / 检查这个观点前文是否矛盾          │
├────────────────────────────────────┤
│ ● 整理第3章论证结构          运行中 0:42 │  ← 任务卡(可展开)
│   ├ plan: 抽取论点 → 找支撑 → 找反例     │  ← Agent 的 planning 可见
│   ├ 正在读:第3章 §2…                    │
│   └ [停止]                              │
│ ✓ 全书高亮生成知识册          已完成     │
│   └ 产物:12 张卡 · 跳到知识区 →          │
└────────────────────────────────────┘
```

### 5.3 OpenCode 接入接口(给后端留的契约,本轮不实现)

定义一个 **`AgentTaskRunner` adapter**,UI 只依赖这个接口,OpenCode 是它的一个实现:

```ts
// 设想接口,落地时放 src/core/agent-task/ 或 stores
type AgentTaskKind =
  | "summarize-chapter"      // 整理本章论证结构
  | "recurring-concepts"     // 找全书反复出现的概念
  | "highlights-to-deck"     // 把高亮生成知识册
  | "contradiction-check"    // 检查观点在前文是否矛盾
  | "freeform"               // 自由指令

type AgentTaskStep = {
  id: string
  label: string              // "抽取论点" —— 人类可读,禁止内部 id
  status: "planning" | "running" | "done" | "error"
  evidence?: EvidencePreview[]   // 复用现有类型,引用可回跳
}

type AgentTask = {
  id: string
  kind: AgentTaskKind
  title: string
  status: "queued" | "running" | "done" | "error" | "stopped"
  steps: AgentTaskStep[]
  startedAt: string
  // 产物:可沉淀为 KnowledgeCard / SavedInterpretation
  artifacts?: { kind: "deck" | "outline" | "report"; cardIds?: string[] }
}

interface AgentTaskRunner {
  run(kind: AgentTaskKind, ctx: { bookId: string; chapterId?: string; prompt?: string }): Promise<string> // taskId
  subscribe(taskId: string, onStep: (task: AgentTask) => void): () => void
  stop(taskId: string): void
}
```

- **UI 层完全不知道 OpenCode 存在**,只渲染 `AgentTask[]`。今天可以先用一个 mock runner 跑通 UI,明天换成 OpenCode runner,UI 零改动。
- **产物必须能回流知识层**:任务产出的 deck/outline 写成 `KnowledgeCard`,在「知识」区可见、引用可回跳原文 chunk。这把「Agent 长任务」和「知识沉淀」缝合起来,而不是各跑各的。

---

## 6. ~~「知识」区~~(已作废 — 见 §3 决策)

> **本节作废。** 知识体系保留为顶栏全屏视图,不进右栏。以下为原始设计,仅作历史记录。

<details>
<summary>原「知识」区设计(已不实现)</summary>

把现在割裂的全屏 `KnowledgePanel` **在右栏开一个「与当前位置相关」的切片**(全屏知识体系视图保留,作为「全书地图」入口)。

```
┌─ 知识 ──────────────────────────────┐
│ 与当前章节相关                          │
│  · 高亮 3   · 已确认卡 2   · 候选 1     │  ← 与当前阅读位置相关的切片
├────────────────────────────────────┤
│ ◆ 复利效应(已确认)        跳原文 →     │
│ ◆ 通胀对实际收益的侵蚀(候选)           │
│ ○ 高亮:第3页「时间是复利的朋友」        │
├────────────────────────────────────┤
│ [打开全书知识地图]                      │  ← 通向现有 knowledge 全屏视图
└────────────────────────────────────┘
```

- 高亮 / 解读 / 笔记 / Agent 产物**统一沉淀为 `kb_cards`**(对齐 `20260607_knowledge-system-implementation-plan.md`)。
- 标签全中文(清单 #5);卡片不露裸 chunkId(清单 #3)。
- 右栏知识区 = 「此刻相关」,全屏 knowledge view = 「全书纵览」。两者通过「打开全书知识地图」连接,不再是顶栏平级竞争。

</details>

---

## 7. 布局与状态机

### 7.1 布局(`reader-view-config.ts`)

- 沿用常驻三栏:`readerLayoutColumns` 的右栏 `360px` 不变。
- `showsInterpretationAside` 语义升级为 `showsWorkbench`:**text / tldr / translation / pdf / knowledge 全部为 true**——即知识体系不再独占全屏、与右栏割裂,而是右栏「知识」Tab 始终在场(全屏 knowledge view 作为「全书地图」仍保留为可选 tab)。
- 窄屏(≤1280,清单 #9):右栏可整体折叠为图标 rail(这是常驻态下的响应式退让,不改变「默认常驻」决策)。

### 7.2 工作台 Tab 状态机

```
            框选并点「解读」
   无选区 ───────────────────────▶ 当前(解读线程)
   (默认: 知识区)                        │ 追问 → 同线程往下
        ▲                               │ 保存为笔记/沉淀 → 写入知识区
        │ 清除选区                        ▼
        └──────────────────────────── (线程保留在历史)

   下达任务(预设/自由指令) ─────────▶ 任务(Agent 驾驶舱)
                                        │ 完成 → 产物落知识区,角标提示
```

- Tab 切换是**用户显式或事件驱动**(触发解读→跳「当前」;任务完成→「任务」角标),**绝不自动抢焦点打断阅读**。
- 一个 `workbenchTab: "current" | "tasks" | "knowledge"` state 取代现在的 `sparkPanelOpen`。

---

## 8. 组件改造映射(落地时的 PR 拆分参考,本轮不实现)

| 现有 | 改造后 | 动作 |
|---|---|---|
| `ReaderInterpretationAside.tsx` | `AiWorkbench.tsx`(三 Tab 容器,纯展示) | 重写为 Tab 容器,保持纯展示(props 下传) |
| `InterpretationCard.tsx` | `CurrentThread`(当前区主体) | 复用,首轮解读 + 检索轨迹 |
| `SparkPanel.tsx` | 并入 `CurrentThread` 的追问 + 轻量 toggle;note → 知识区 | 拆解,移除独立面板 |
| —(新增) | `TasksPanel.tsx` + `AgentTaskRunner` adapter | 新建,先接 mock runner |
| `KnowledgePanel.tsx`(全屏) | 保留为「全书地图」+ 派生 `KnowledgeSlice`(右栏知识区) | 抽出「当前相关」切片 |
| `reader-store`:`sparkPanelOpen` | `workbenchTab` + `agentTasks: AgentTask[]` | 状态机改造 |
| `reader-view-config`:`showsInterpretationAside` | `showsWorkbench`(几乎恒 true) | 语义升级 |

---

## 9. 明确不做(避免设计跑偏)

- ❌ 不把右栏做成永久通用 ChatGPT。AI 价值是「基于原文、可回跳、可沉淀」,不是闲聊。
- ❌ 不把解读 / TLDR / Spark / OpenCode / 知识体系 在顶栏平级铺开。
- ❌ 不让 Agent 终端变成第二个追问框(用 §5.1 的作用域边界隔开)。
- ❌ 不默认弹出 / 抢焦点打断阅读(Tab 只角标提示)。

---

## 10. 验收标准(spec 落地后)

- [ ] 右栏只有一套对话线程(「当前」),`sparkPanelOpen` 二选一被消除。
- [ ] 框选 → 解读 → 追问在一条线程内完成,无面板切换。
- [ ] 「任务」区可下达 ≥1 个预设长任务,展示 plan/进度/产物,产物可回流知识区。
- [ ] OpenCode 通过 `AgentTaskRunner` 接入,UI 不直接依赖 OpenCode;可用 mock runner 先跑通。
- [ ] 「知识」区展示与当前位置相关的高亮/卡片,可回跳原文,无裸 chunkId、标签全中文。
- [ ] 顶栏不再把知识体系作为与阅读平级的竞争入口。
- [ ] 默认阅读态安静:无选区时右栏是知识区,不打断。

---

## 11. 下一步

1. **本文 review 通过后** → 拆 PR:`P1` 工作台 Tab 容器 + 状态机(`workbenchTab` 替 `sparkPanelOpen`);`P2` 合并解读线程(收编 SparkPanel);`P3` 任务区 + mock `AgentTaskRunner`;`P4` 知识切片 + 全书地图连接;`P5` 接 OpenCode runner。
2. 每个 P 配 Storybook 状态 + 测试(对齐现有 `ReaderShell.test.tsx` / stories 全绿基线)。
