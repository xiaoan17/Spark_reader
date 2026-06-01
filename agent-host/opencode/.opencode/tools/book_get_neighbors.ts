import { tool } from "@opencode-ai/plugin";
import { callBookTool } from "../lib/book-tool-client";

export default tool({
  description:
    "Fetch nearby chunks around a known chunk_id to understand immediate page context.",
  args: {
    bookId: tool.schema.string(),
    chunkId: tool.schema.string(),
    radius: tool.schema.number().optional(),
  },
  async execute(args) {
    return callBookTool("book_get_neighbors", {
      bookId: args.bookId,
      chunkId: args.chunkId,
      radius: args.radius ?? 1,
    });
  },
});
