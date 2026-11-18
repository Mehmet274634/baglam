# Website and panel redesign — design

## Why
Bağlam works; it now needs to look like the top-tier product it is. The owner wants a high-end,
bilingual (English + Turkish) marketing site of 8–9 pages that explains the system well, and a panel
in the same design language, so the product feels like one thing from first visit to daily use.

## References (design language only; nothing is copied)
- **Linear** — near-black canvas, thin luminous 1 px borders, dark cards with a faint top highlight,
  fine-line isometric illustrations inside cards, large tightly tracked headlines.
- **Stripe** — two-tone headlines (first sentence bright, the rest muted), cards that contain real
  product UI, a bento grid of feature cards, occasional light sections between dark ones.
- **Polar** — calm, generous spacing, white pill buttons, product windows floating on a grainy
  monochrome gradient.
- **Gamma (closing section)** — a huge brand wordmark at the very bottom with a large "head"
  illustration. Ours: a line-art head whose mind is a glowing network of memory nodes, above a
  giant **BAĞLAM** wordmark.

## Goals
- 9 pages × 2 languages: Home, How it works, Handoff (continue where you left off), Automatic saving
  & autonomous mode, Security & privacy, Supported tools, Get started, Pricing, FAQ.
- Dark first, with a few light sections (owner: "koyu, yer yer daha açık tonlar").
- Every claim true to the product as built (1.0.0-rc.3). Product visuals show real Bağlam output
  (brief, handoff card, CLI lines), rendered as HTML, not screenshots.
- Fast and accessible: static HTML, almost no JavaScript, works without JS, keyboard and screen
  reader friendly, respects reduced motion, phone layout without horizontal scroll.
- The panel adopts the same tokens: colours, type, card style, buttons, borders.

## Non-goals
- Hosting/deploy, domain, analytics (later, owner's decision).
- Blog, docs portal, account system, waitlist backend.
- Changing panel features or flows.

## Anti-goals
- Fake social proof: no invented customer logos, testimonials, user counts or "trusted by".
  The tools strip says "Works with" and lists the six tools by name in plain text (no trademarks).
- Tracking or third-party requests: fonts are self-hosted, no external scripts.
- A look that copies any reference site's layout or artwork.

## Approaches considered
1. **Astro static site (chosen)** — shared layout/components, one content dictionary per language,
   routes `/` (English) and `/tr/` (Turkish), zero JS by default, one-step deploy later.
2. Plain HTML files — no tooling, but nav/footer copied into 18 files; every change made 18 times.
3. Next.js — heavier than a static marketing site needs.
Head illustration: **hand-made line-art SVG (chosen)** over an AI-generated image (credits, harder to
keep consistent with the line-illustration style, not theme-able).

## Design
### Tokens (shared by site and panel)
- Canvas `#08090a`, surface `#0f1011`, raised `#151619`, border `rgb(255 255 255 / 8%)`,
  border-strong `rgb(255 255 255 / 14%)`, text `#f7f8f8`, muted `#8a8f98`, faint `#5c6069`.
- Accent: Bağlam indigo `#7c74ff` (hover `#958fff`), with a cyan companion `#3fd0c9` for the
  "memory network" glow. Light sections: `#f4f5f7` canvas, `#ffffff` cards, text `#0b0c0e`.
- Type: Inter Variable (self-hosted), headlines 600 weight, letter-spacing −0.03em, display sizes
  `clamp(2.6rem, 6vw, 4.8rem)`; JetBrains Mono for code.
- Radius 14 px cards, 999 px pills; card = surface + 1 px border + inset top highlight
  (`inset 0 1px 0 rgb(255 255 255 / 6%)`) + soft radial glow on hover.

### Site structure
- `site/` becomes an Astro project (own package.json, not part of the npm package).
- `src/i18n/{en,tr}.ts` — all copy, same keys; `src/components/*` — Nav (sticky, blurred, language
  switch that maps to the same page in the other language), Hero, TwoToneHeading, Card/Bento,
  ProductWindow (renders a brief/handoff card), Terminal, Steps, ToolGrid, FAQ (`<details>`),
  CTA, Footer (head SVG + giant wordmark); `src/pages/[page].astro` + `src/pages/tr/[page].astro`
  render one shared page component per page with `lang`.
- Line illustrations (isometric, 1 px strokes) as inline SVG components: layered memory stack,
  two agents passing a card, shield, plug grid, terminal.

### Pages (content outline)
1. Home — hero "One memory for every AI coding agent" + product window (Continue from here),
   works-with strip, bento (shared memory, handoff, automatic saving, approval, secrets blocked,
   local-first), how-it-works in 3 steps (light section), closing CTA, head + wordmark footer.
2. How it works — propose → approve → every agent knows; brief; search; records kinds.
3. Handoff — checkpoint, git "since then", resume prompt for any tool, branch-aware.
4. Automatic saving & autonomous mode — hooks save request/files/reply; switch; autonomous review.
5. Security & privacy — local SQLite, secrets guard, approval, panel protections, no telemetry.
6. Supported tools — six tools, what setup writes for each, Codex trust note.
7. Get started — install, setup, init, doctor, first handoff; copyable commands.
8. Pricing — Individuals: free, open source (MIT). Teams: coming later (honest, no form).
9. FAQ — 10–12 real questions.

### Panel
Replace `ui/src/styles.css` tokens and component styles with the shared ones (dark default, light
theme kept for users who choose it), Inter/JetBrains Mono bundled, Linear-style cards and pill
buttons. Markup changes only where a class is needed; all panel tests stay green.

## Left to the builder
Exact copy wording (both languages, natural Turkish), illustration details, spacing scale,
animation details (subtle, reduced-motion safe).
