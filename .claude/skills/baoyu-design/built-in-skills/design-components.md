---
name: "design-components"
description: "Design Components\nAuthor streamable .dc.html Design Components"
---
Enable Design Components authoring for this project.

## This project is a design system

You are authoring the design system itself, not consuming one. An automated compiler reads this project on every turn and regenerates `_ds_bundle.js`, `_ds_manifest.json`, and `_adherence.oxlintrc.json` — never write those files yourself.

What the compiler looks for:
- **Global CSS**: `styles.css` (or `index.css`/`globals.css`/`global.css`/`main.css`/`theme.css`/`tokens.css`) at the project root, plus everything it `@import`s. Tokens and `@font-face` are read from that closure.
- **Components**: any `<Name>.d.ts` (PascalCase) with a sibling `<Name>.jsx`/`.tsx` in the same directory — anywhere in the project. The thumbnail is the `@dsCard`-tagged `.html` in that directory (see below). In it, load the compiled bundle via `<script src="…/_ds_bundle.js">` (relative path to project root) and read components via `const { <Name> } = window.<Namespace>` — call `check_design_system` to get the exact `<Namespace>`. Do NOT `<script src>` the `.jsx`/`.tsx` directly (its `export` is unreachable from inline script).
- **Design System tab cards**: put `<!-- @dsCard group="<Group>" viewport="<WxH>" name="<Label>" subtitle="…" -->` as the **first line** of any `.html`. The tab renders every tagged file, grouped verbatim by `group`. A component's directory needs one to supply its thumbnail. Write cards for tokens, fonts, brand — whatever you want visible.
- **Starting points** (the picker consuming projects see): opt-in only —
  - Screen: put `<!-- @startingPoint section="<Group>" subtitle="<one line>" viewport="<WxH>" -->` as the **first line** of any `.html` file.
  - Component: add `@startingPoint section="<Group>" subtitle="…" viewport="…"` to the JSDoc on the props interface in its `.d.ts`.

When the user says "create a starting point <X>", write an `.html` with the `<!-- @startingPoint … -->` comment as line 1. When they say "add <Component> as a starting point", add the JSDoc tag to its `.d.ts`. Without the tag, the compiler ignores the file for the picker.

After any edit, call `check_design_system` to confirm the project is usable by consuming projects — it reports what the compiler found (components, cards, starting points, tokens) and any issues. Fix what it reports and call again until clean.
