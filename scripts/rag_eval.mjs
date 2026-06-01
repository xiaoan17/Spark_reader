#!/usr/bin/env node

const chunks = [
  {
    chunkId: "b11111111-p1-c1-aaaaaaaa",
    text: "复利的力量不来自某一次惊人的收益，而来自长期坚持、时间累积和耐心。",
  },
  {
    chunkId: "b11111111-p2-c1-bbbbbbbb",
    text: "风险控制让长期计划不被短期波动打断，安全边际和仓位管理都很重要。",
  },
  {
    chunkId: "b11111111-p3-c1-cccccccc",
    text: "现金流决定一个人能否持续投入，流动性不足会迫使计划提前终止。",
  },
  {
    chunkId: "b11111111-p4-c1-dddddddd",
    text: "市场价格由供需、竞争格局和参与者预期共同塑造。",
  },
  {
    chunkId: "b11111111-p5-c1-eeeeeeee",
    text: "认知模型是一套帮助判断和决策的框架，关键在于理解机制而不是背结论。",
  },
]

const cases = [
  {
    query: "为什么收益需要拉长看",
    expected: ["b11111111-p1-c1-aaaaaaaa"],
  },
  {
    query: "怎样避免短期下跌破坏计划",
    expected: ["b11111111-p2-c1-bbbbbbbb"],
  },
  {
    query: "持续投入为什么需要备用资金",
    expected: ["b11111111-p3-c1-cccccccc"],
  },
  {
    query: "价格变化背后的行业格局",
    expected: ["b11111111-p4-c1-dddddddd"],
  },
  {
    query: "理解底层逻辑有什么用",
    expected: ["b11111111-p5-c1-eeeeeeee"],
  },
]

const conceptExpansions = [
  ["收益", "复利 长期 时间 增长"],
  ["下跌", "风险 波动 控制 安全边际"],
  ["长期计划", "长期 计划 风险 控制"],
  ["持续投入", "现金流 流动性 持续 投入"],
  ["备用资金", "现金流 流动性 持续"],
  ["流动性", "现金流 流动性 持续"],
  ["价格", "市场 价格 供需 竞争"],
  ["行业格局", "市场 价格 供需 竞争"],
  ["底层逻辑", "模型 框架 机制 理解"],
  ["机制", "模型 框架 机制 理解"],
  ["决策", "认知 判断 决策 框架"],
]

function terms(query, expanded) {
  const compact = query.toLowerCase().replace(/\s+/g, "")
  const values = new Set()
  for (const token of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    values.add(token)
  }
  if (!expanded) {
    return [...values].filter((term) => term.length >= 2)
  }
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index + size <= compact.length; index += 1) {
      values.add(compact.slice(index, index + size))
    }
  }
  for (const [needle, rewrite] of conceptExpansions) {
    if (query.includes(needle)) {
      for (const token of rewrite.split(/\s+/)) {
        values.add(token.toLowerCase())
      }
    }
  }
  return [...values].filter((term) => term.length >= 2)
}

function rank(query, expanded) {
  const queryTerms = terms(query, expanded)
  return chunks
    .map((chunk) => {
      const haystack = chunk.text.toLowerCase()
      const score = queryTerms.reduce((sum, term) => sum + (haystack.includes(term) ? term.length : 0), 0)
      return { chunkId: chunk.chunkId, score }
    })
    .filter((hit) => hit.score > 0)
    .sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId))
}

function recallAt(k, expanded) {
  const hits = cases.filter((testCase) => {
    const topK = rank(testCase.query, expanded).slice(0, k).map((hit) => hit.chunkId)
    return testCase.expected.some((chunkId) => topK.includes(chunkId))
  }).length
  return hits / cases.length
}

const baseline = {
  "recall@1": recallAt(1, false),
  "recall@3": recallAt(3, false),
  "recall@5": recallAt(5, false),
}
const rewritten = {
  "recall@1": recallAt(1, true),
  "recall@3": recallAt(3, true),
  "recall@5": recallAt(5, true),
}

console.log(JSON.stringify({ cases: cases.length, baseline, rewritten }, null, 2))

if (rewritten["recall@1"] < baseline["recall@1"] || rewritten["recall@3"] < baseline["recall@3"]) {
  console.error("RAG eval regression: rewritten recall dropped below baseline")
  process.exit(1)
}
