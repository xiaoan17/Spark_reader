import { tool } from "@opencode-ai/plugin";
import { callBookTool } from "../lib/book-tool-client";

export default tool({
  description:
    "List coarse book structure or page-leading chunks. Use this only to orient retrieval, not as final evidence by itself.",
  args: {
    bookId: tool.schema.string(),
  },
  async execute(args) {
    return callBookTool("book_structure", {
      bookId: args.bookId,
    });
  },
});
