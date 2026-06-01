import { tool } from "@opencode-ai/plugin";
import { callBookTool } from "../lib/book-tool-client";

export default tool({
  description:
    "Search the current PDF book for evidence related to the selected passage. Returns chunks with stable [chunk_id] citations.",
  args: {
    bookId: tool.schema.string(),
    query: tool.schema.string(),
    limit: tool.schema.number().optional(),
  },
  async execute(args) {
    return callBookTool("book_search", {
      bookId: args.bookId,
      query: args.query,
      limit: args.limit ?? 6,
    });
  },
});
