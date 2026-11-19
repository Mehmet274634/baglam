# Bağlam design system

> **Türkçe özet:** Site ve panel aynı tasarım dilini kullanır: koyu, Linear/Stripe/Polar/Gamma
> çizgisinde, ince çizgiler, yolculuk eden ışık, indigo + turkuaz vurgu. Bu dosya renkleri, yazı
> tiplerini, bileşenleri, efektleri ve sahibinin şimdiye kadar verdiği tasarım kararlarını kaydeder.
> Yeni bir tasarım işine başlamadan önce "Owner decisions" bölümünü oku.

Last updated: 2026-11-19. Read this first for any work on the website (`site/`) or the look of the
panel (`ui/`). Product logic lives in [STATUS.md](STATUS.md).

## Direction

- References the owner chose: **linear.app** (cards), **stripe.com** (overall structure, cards),
  **polar.sh**, **gamma.app/tr** (big statements, the giant wordmark/head at the bottom).
- Mood: dark canvas, slightly lighter bands for rhythm, fine 1px lines, light travelling along
  lines, indigo `#7c74ff` with cyan `#3fd0c9`. Every page should impress on first sight, but text
  always stays readable and effects never block content.
- Bilingual: English at `/`, Turkish at `/tr/`. Every string lives in `site/src/i18n/{en,tr}.ts`; the
  build check fails if the two languages' keys differ.

## Owner decisions (keep these unless the owner changes them)

- **Dark only** on the website (the panel follows the system: dark by default, light when the OS is
  light).
- No eyebrow labels above page titles, no "01 · …" chapter labels, no "Local-first · Open source"
  tagline, no install command line in the home hero.
- Opening rays (home `HeroBeams`, page `PageFx` "rays") are **still lines**: nothing moves on them.
- "Works with" is **one row** moving right to left (it keeps moving, slower, with reduced motion).
- The connections visual (`Constellation`) is the most important visual: a constant two-way data
  flow, glowing beams, comet packets, a core with HUD rings, tiles with light running round the edge.
- **Phones:** the home page's first screen is exactly one screen (bar + title + text + buttons + logo
  strip, nothing from the next section). Page titles sit just under the bar. Desktop is untouched by
  phone rules (all phone rules live in `max-width: 640px` blocks).
- Brand marks only from Simple Icons (CC0). No freely licensed mark for Codex/OpenAI, VS Code,
  Antigravity or Windows, so those use neutral glyphs; never imitate a trademark.
- The owner's Windows has animation effects off (reduced motion). Decorative continuous flows keep
  running gently in that mode; flashes, bursts and scaling stop.

## Tokens

Source of truth: `site/src/styles/tokens.css` (the panel mirrors them in `ui/src/styles.css`).

| Token | Value | Use |
|---|---|---|
| `--canvas` | `#08090a` | page background |
| `--surface` / `--raised` / `--raised-2` | `#0f1011` / `#151619` / `#1b1c20` | bands, cards, raised cards |
| `--border` / `--border-strong` | white 8% / 14% | 1px lines |
| `--text` / `--muted` / `--faint` | `#f7f8f8` / `#8a8f98` / `#7d828b` | text levels (`.dim` = second tone of a headline) |
| `--accent` / `--accent-hover` | `#7c74ff` / `#958fff` | primary accent |
| `--cyan` | `#3fd0c9` | second accent, "outgoing / shared" |
| `--ok` / `--warn` / `--danger` | `#4cc58a` / `#f0b44c` / `#ff7a6e` | states |
| `--font` / `--mono` | Inter Variable / JetBrains Mono Variable | self-hosted via @fontsource |
| `--r-card` / `--r-small` / `--r-pill` | 14px / 8px / 999px | radii |
| `--wrap` / `--gutter` | 1200px / clamp(16px, 4vw, 32px) | layout |
| `--ease` | `cubic-bezier(0.2, 0.7, 0.2, 1)` | all transitions |

Tool colours (constellation, marquee): Claude `#E8916F`, Codex `#d9dcff`, Cursor `#c9d1ff`,
Antigravity `#8ab4f8`, Gemini `#b49cf0`, VS Code · Copilot `#9fd7ff`, Windsurf `#4fe0d8`.

## Type scale

`.display` clamp(2.5rem, 6.2vw, 4.75rem), weight 600, tight tracking, `text-wrap: balance`; home
hero title larger with a white→grey gradient. `.statement` for big Gamma-style sentences. `.h2`,
`.h3`, `.lead`. Headlines are two-tone: bright first part, `.dim` second part.

## Components (`site/src/components/`)

| Component | Role |
|---|---|
| `Nav` | floating glass bar, Product dropdown, GitHub link, EN/TR switch, phone menu; sticky, 70px tall |
| `PageHero` | centred page opening with an `fx` prop |
| `PageFx` | page-opening light effects: `rays` (still), `orbit`, `streams`, `scan`, `aurora` |
| `HeroBeams` | home opening background (still rays from a glowing point) |
| `Marquee` | "Works with" strip |
| `Constellation` | tools wired to Bağlam (home and Connections page) |
| `PanelMock` | panel screenshot-like mock (inbox, records, settings) |
| `Brief`, `Terminal` | product UI fragments |
| `SectionHead`, `Cta`, `Footer` (giant wordmark), `Logo` (two rings with a gradient lens) | structure |
| `illustrations/Art`, `illustrations/Head` | line illustrations for cards |

Page → effect: each view in `site/src/views/` passes an `fx` to `PageHero`.

Cards (`global.css`): conic edge light via `@property --ring` plus a spotlight; reveal on scroll
(blur + stagger), `.rise` uses scroll-driven animation where supported. `.band` = slightly lighter
section.

## Motion rules

- SMIL `animateMotion` + `mpath` for anything travelling along a path; CSS keyframes for the rest;
  `@property` angles for light running around rounded shapes (rotating the box itself looks wrong).
- Particles glow with radial-gradient fills, not blur filters (filters on moving groups are costly).
- Reduced motion: keep slow continuous flows, drop flashes, bursts, pulses, scaling and bobbing.

## Checks before shipping a design change

1. `cd site && npm run build` → must end with "22 pages checked ✓ all checks passed".
2. Phone: no horizontal overflow at 375px on all 22 pages; home first screen ends at the viewport
   bottom on 360×740, 375×667, 375×812, 390×844, 430×932.
3. Desktop look unchanged unless the change is meant for desktop.
4. Pushing `main` deploys the site on Vercel within a minute or two; tell the owner to refresh.

Known testing quirk: in the app's browser pane, a hidden pane freezes entry animations, so screenshots
can show blurred or missing text. Measure with `getBoundingClientRect` in same-origin iframes, or
disable the entry animations in the inspected page before a screenshot.

## Panel

`ui/src/styles.css` uses the same tokens; Inter and JetBrains Mono woff2 (Latin + Latin-ext) are
bundled in `ui/src/fonts/` with their OFL licences. Logo SVG in `ui/src/app.tsx`, favicon data URI in
`ui/index.html`. Screens: Inbox, Records, Projects, Settings.

## Open ideas (not started)

- Bring the constellation-style data flow into the panel's empty states.
- A custom domain for the site (see STATUS.md).
