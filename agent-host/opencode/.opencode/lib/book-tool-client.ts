type ToolPayload = Record<string, unknown>;

const baseUrl = process.env.FOCUSED_READING_BOOK_TOOL_BASE_URL ?? "http://127.0.0.1:48173";
const token = process.env.FOCUSED_READING_BOOK_TOOL_TOKEN ?? "";

export async function callBookTool<T>(toolName: string, payload: ToolPayload): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/tools/${toolName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`book tool ${toolName} failed: ${response.status} ${text}`);
  }

  return JSON.parse(text) as T;
}
