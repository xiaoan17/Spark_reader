import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react"
import { Button } from "@/components/ui/button"
import { AnimatedValue } from "./animated-value"

const meta = {
  title: "UI/AnimatedValue",
  component: AnimatedValue,
  args: {
    value: "正在检索",
  },
} satisfies Meta<typeof AnimatedValue>

export default meta
type Story = StoryObj<typeof meta>

export const Text: Story = {
  render: () => <AnimatedTextDemo />,
}

export const Number: Story = {
  render: () => <AnimatedNumberDemo />,
}

export const LongTextFallback: Story = {
  args: {
    value: "这是一段超过默认长度限制的说明文本，会退回普通 span，避免正文级内容被字符级动效干扰。",
  },
}

function AnimatedTextDemo() {
  const labels = ["正在规划", "正在检索证据", "正在生成"]
  const [index, setIndex] = useState(0)
  return (
    <div className="space-y-3 rounded-md border bg-background p-4">
      <div className="text-sm font-medium">
        <AnimatedValue value={labels[index]} />
      </div>
      <Button size="sm" onClick={() => setIndex((value) => (value + 1) % labels.length)}>
        切换状态
      </Button>
    </div>
  )
}

function AnimatedNumberDemo() {
  const [count, setCount] = useState(1)
  return (
    <div className="space-y-3 rounded-md border bg-background p-4">
      <div className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
        运行中
        <AnimatedValue value={count} variant="number" animation="snappy" />
      </div>
      <Button size="sm" onClick={() => setCount((value) => (value % 9) + 1)}>
        更新计数
      </Button>
    </div>
  )
}
