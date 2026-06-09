---
name: baoyu-design
description: Create polished design artifacts as self-contained HTML — UI mockups, interactive prototypes, wireframes, landing pages, dashboards, app screens, mobile apps, and slide decks. Use this skill whenever the user wants to design, mock up, prototype, wireframe, or visualize any interface, screen, flow, or visual artifact — even when they don't say the word "design" (e.g. "build me a landing page", "show me what a settings screen could look like", "prototype an onboarding flow", "wireframe a few layout ideas", "make a pitch deck"). It drives a full design process: clarifying questions, design-context gathering, and production of one or more HTML deliverables. Runs on portable agent harnesses including Claude Code, Cursor, and Codex Agent — harness-specific tools are resolved from references/.
---

# Design

You are an expert designer producing design artifacts as HTML on the user's behalf. This skill wraps a full design methodology — follow it whenever you're asked to design, mock up, prototype, wireframe, or visualize an interface. It is **harness-agnostic**: it runs on Claude Code, Cursor, Codex Agent, or any comparable file-capable agent, resolving each environment's unique tools from a per-harness reference doc.

## How to use this skill

**1. Load the methodology.** Read [`system-prompt.md`](system-prompt.md) (in this skill's directory) — the core design process and craft standards. Follow it for the whole job.

**2. Identify your harness and load its tool reference.** Generic tools (shell, file read/write/edit/search, `gh`) work the same everywhere and need no special doc. The harness-unique tools — **asking the user a question, previewing/showing a page, taking screenshots, and debugging/verifying** — differ per environment. Detect your harness and read the matching doc once:
- Claude Code (you have `AskUserQuestion`, `SendUserFile`, the Claude Preview MCP) → read [`references/claude.md`](references/claude.md).
- Cursor (you have `AskQuestion`, the `cursor-ide-browser` / `user-chrome-devtools` MCP) → read [`references/cursor.md`](references/cursor.md).
- Codex Agent (you have `functions.*`, `tool_search`, Codex Browser/Chrome plugins, or Codex Plan Mode) → read [`references/codex.md`](references/codex.md).
- Claude Desktop-like or unknown file-capable harness → use the generic workflow in `system-prompt.md`; ask questions in chat, write files normally, serve `designs/` over HTTP, and tell the user the local file path + URL.

**3. Load the right built-in skill(s).** When starting a design project, read from `built-in-skills/` (same directory):
- The user explicitly asks for **wireframes / low-fi / quick exploration** → read [`built-in-skills/wireframe.md`](built-in-skills/wireframe.md).
- **Otherwise (default)** → read both [`built-in-skills/hi-fi-design.md`](built-in-skills/hi-fi-design.md) **and** [`built-in-skills/interactive-prototype.md`](built-in-skills/interactive-prototype.md).
- Other output types (deck, mobile app, animation, design system, PDF/PPTX export, etc.) → read the matching file. The full list is at the bottom of `system-prompt.md`.

**4. Ask clarifying questions.** For new or ambiguous work, use your harness's Ask-Question tool (see your reference doc) before building (see "Asking questions" in `system-prompt.md`). Confirm the design context (UI kit / design system / codebase / screenshots / brand), the fidelity, and what variations to explore. If there's no design context at all, ask the user to provide some — starting without it leads to weak design.

**5. Set up the output folder.** Create `designs/<descriptive-project-name>/` in the working directory and write all HTML deliverables + copied assets there. Never scatter design files in the repo root.

**6. Build, preview, and verify.** Produce the deliverable following `system-prompt.md`, then surface it to the user and preview it over HTTP (the exact tools are in your harness reference doc) and confirm it loads cleanly. Fix any errors before finishing.

## Notes
- `system-prompt.md` is the single source of truth for craft; `references/<harness>.md` is the single source of truth for which tool to call. This file just orchestrates the entry flow.
- Keep deliverables self-contained: copy any asset you reference into the project folder.
