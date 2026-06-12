import type { Meta, StoryObj } from "@storybook/react"
import { ZoteroImportPanel } from "./ZoteroImportPanel"
import type { ZoteroSearchResult } from "@/core/library-api"

const zoteroResults: ZoteroSearchResult[] = [
  {
    itemKey: "ABCD1234",
    title: "Attention Is All You Need",
    creators: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"],
    year: "2017",
    itemType: "conferencePaper",
    attachmentKey: "PDF123",
    attachmentTitle: "Vaswani et al. - Attention Is All You Need.pdf",
    hasPdf: true,
  },
  {
    itemKey: "EFGH5678",
    title: "A Survey of Retrieval-Augmented Generation for Large Language Models",
    creators: ["Yunfan Gao", "Yun Xiong"],
    year: "2024",
    itemType: "journalArticle",
    hasPdf: false,
  },
]

const meta = {
  title: "Reader/ZoteroImportPanel",
  component: ZoteroImportPanel,
  args: {
    open: true,
    query: "retrieval augmented generation",
    results: zoteroResults,
    status: "idle",
    message: "找到 2 条 Zotero 文献",
    onQueryChange: () => undefined,
    onSearch: () => undefined,
    onImport: () => undefined,
    onClose: () => undefined,
  },
} satisfies Meta<typeof ZoteroImportPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Results: Story = {}

export const Empty: Story = {
  args: {
    query: "",
    results: [],
    message: "",
  },
}

export const Searching: Story = {
  args: {
    status: "searching",
    results: [],
    message: "",
  },
}

export const Importing: Story = {
  args: {
    status: "importing",
    importingItemKey: "ABCD1234",
    message: "正在从 Zotero 导入《Attention Is All You Need》",
  },
}

export const Error: Story = {
  args: {
    status: "error",
    results: [],
    message: "没有找到匹配文献；请确认 Zotero 已打开、PDF 附件仍在本机，并尝试更短标题。",
  },
}

export const Closed: Story = {
  args: {
    open: false,
  },
}
