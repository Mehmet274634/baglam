# Website and panel redesign — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 9-page English/Turkish Astro site and a restyled panel sharing one dark design language.
**Architecture:** `site/` is its own Astro 7 package with shared components and per-language copy; the panel keeps Preact and swaps its stylesheet for the shared tokens.
**Tech Stack:** Astro 7.4, @fontsource-variable/inter 5.3, @fontsource-variable/jetbrains-mono 5.3, Preact/Vite (panel).
**Spec:** `docs/superpowers/specs/2026-11-18-site-and-panel-design.md`

## Global Constraints
- No external requests at runtime (fonts self-hosted, no CDN, no analytics).
- No invented social proof; tools named in plain text.
- English at `/`, Turkish at `/tr/`; every page exists in both; the language switch keeps the page.
- Works without JavaScript; `prefers-reduced-motion` disables animation; no horizontal scroll at 375 px.
- Panel tests (`npx vitest run`) stay green; `dist/` is rebuilt only with `npm run build` at the end.

## Review Focus
- A Turkish page links to an English page (or a 404) → link check over the built site.
- A key present in one language and missing in the other → `tr` typed as `typeof en`.
- Long Turkish words overflow cards on phones → visual check at 375 px for every page.
- Light sections lose contrast (muted text on light canvas) → check contrast of muted on light.
- Panel loses readability in its light theme after the token swap → screenshot both themes.

---

### Task 1: Astro project, tokens, layout, nav, footer
- Create `site/package.json` (astro, fonts), `site/astro.config.mjs` (static, `trailingSlash: "always"`, i18n off — routes by folder), `site/src/styles/tokens.css`, `site/src/styles/global.css`, `site/src/layouts/Base.astro` (meta, og, hreflang alternates, skip link), `site/src/components/Nav.astro`, `Footer.astro` (head SVG + giant wordmark), `site/src/i18n/{en,tr}.ts`, `site/src/i18n/pages.ts` (slug list + paths per language).
- Verify: `npm --prefix site run build` succeeds; home renders in both languages.

### Task 2: Components and illustrations
- `TwoTone.astro`, `Card.astro`, `Bento.astro`, `ProductWindow.astro` (brief/handoff card markup), `Terminal.astro` (copy button, progressive), `Steps.astro`, `ToolGrid.astro`, `Faq.astro`, `Cta.astro`, `illustrations/*.astro` (memory stack, handoff, shield, plugs, terminal, head network).

### Task 3: The nine pages, both languages
- `site/src/pages/{index,how-it-works,handoff,automatic-saving,security,tools,get-started,pricing,faq}.astro` and the same under `site/src/pages/tr/`, each a thin wrapper around `site/src/views/<Page>.astro` with `lang`.
- Copy in natural Turkish and English, true to 1.0.0-rc.3.

### Task 4: Checks
- `site/scripts/check.mjs`: builds, then for every HTML file: internal links resolve, both language versions exist, `<html lang>` correct, no `http(s)://` script/link/img to other hosts, every page has title + description.
- Visual pass in the browser at 1280 px and 375 px, every page, both languages; fix overflow.

### Task 5: Panel in the same language
- Replace tokens/components in `ui/src/styles.css` (dark default, light kept), bundle fonts via `ui/src/main.tsx` imports, adjust markup classes only where needed.
- Verify: `npx vitest run` green, panel screenshots dark + light, phone width.

### Task 6: Finish
- Remove the old `site/index.html`, README link to the site, CHANGELOG, commit, merge, `npm run build`, final fresh review of the branch, fix findings.
