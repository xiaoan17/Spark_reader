import { tool } from "@opencode-ai/plugin";
import { callBookTool } from "../lib/book-tool-client";

export default tool({
  description:
    "Fetch one exact book chunk by chunk_id. Use this when a citation needs full local context.",
  args: {
    bookId: tool.schema.string(),
    chunkId: tool.schema.string(),
  },
  async execute(args) {
    return callBookTool("book_get_chunk", {
      bookId: args.bookId,
      chunkId: args.chunkId,
    });
  },
});
