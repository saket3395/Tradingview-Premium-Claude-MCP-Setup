---
name: TV × Claude Intraday MCP
description: An honest, dark trading terminal that reads your own TradingView session and never fabricates.
colors:
  terminal-ink: "#0e1117"
  panel: "#161b22"
  inset: "#0f141b"
  well: "#0b0f15"
  hairline: "#272e3a"
  text: "#d7dde6"
  text-muted: "#8b97a7"
  bull: "#26a17b"
  bear: "#e5534b"
  caution: "#d9a441"
  interactive: "#3b82f6"
  control: "#1f2733"
  hairline-soft: "#1e242e"
  text-dim: "#5d6877"
  bull-fill: "#10261f"
  bull-line: "#1f3b30"
  bear-fill: "#2a1716"
  bear-line: "#3b2422"
  caution-fill: "#2a2410"
  caution-line: "#3a3115"
  interactive-fill: "#1c2740"
  interactive-line: "#1e3050"
  interactive-on-fill: "#5c98f8"
  target: "#3fb6a8"
  target-fill: "#122a2a"
  neutral-fill: "#20242c"
typography:
  symbol:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: "1.1"
    letterSpacing: "normal"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "1.3"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "1.45"
  data:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "1.5"
    fontFeature: "'tnum' 1"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: "1.2"
    letterSpacing: "0.4px"
rounded:
  xs: "5px"
  sm: "6px"
  md: "8px"
  card: "10px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  xxl: "24px"
sizing:
  control-height: "28px"
  data-row-height: "30px"
  shell: "1760px"
  shell-narrow: "1280px"
components:
  button:
    backgroundColor: "{colors.control}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "5px 11px"
  pill:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "12px"
  input:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "5px 10px"
  tab-active:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "5px 12px"
  decision-tile:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "7px 9px"
  state-valid:
    backgroundColor: "#10261f"
    textColor: "{colors.bull}"
    rounded: "{rounded.sm}"
    padding: "2px 7px"
  state-armed:
    backgroundColor: "#1c2740"
    textColor: "{colors.interactive}"
    rounded: "{rounded.sm}"
    padding: "2px 7px"
  state-invalid:
    backgroundColor: "#2a1716"
    textColor: "{colors.bear}"
    rounded: "{rounded.sm}"
    padding: "2px 7px"
---

# Design System: TV × Claude Intraday MCP

## Overview

**Creative North Star: "The Honest Terminal"** — with the transparency of *The Analyst's Desk*.

This is a professional-grade trading instrument that never lies. The surface is dark, dense, and information-first: the calm authority of a Bloomberg-class cockpit, where numbers are the hero and chrome gets out of the way. Every panel is a rectangle of near-black glass with a single hairline edge; data sits in tight, tabular rows; the four signal colors flare only when the market means something. Nothing is decorative, because in a tool people risk money against, decoration reads as noise — or worse, as a claim.

Tempering that terminal severity is the *Analyst's Desk*: the system **shows its work**. Every analysis surface carries a collapsible "How it works" and "How to trade this" disclosure, jargon has a glossary, and a missing data source renders an honest "no data" rather than an invented number. This is the visual expression of the product's core promise — analysis, not execution; never fabricate. The terminal is dense *and* legible to a newcomer at the same time: hierarchy and plain-language labels do the teaching, so density never becomes intimidation.

The world rejects: gradients-as-decoration, drop shadows on resting surfaces, hero marketing flourishes, and — above all — any color used for prettiness rather than meaning.

**Key Characteristics:**
- Dark tonal terminal: four stacked greys carry all structure; four signal colors carry all meaning.
- Hairline, not shadow — 1px borders define every surface; depth is tonal.
- Tabular by nature — monospaced, right-aligned, `tnum` numerics that don't jitter as they tick.
- Self-documenting — "How it works" disclosures and honest empty states are first-class components.
- High density, high legibility — a pro tool a newcomer can still read.

## Colors

A four-grey neutral chassis carrying four meaning-only signal colors on a near-black blue-charcoal ground.

### Primary
- **Interactive Blue** (`#3b82f6`): the single interactive/attention hue — focus borders, the ARMED signal state, "Good" confidence, active affordances. It says *you can act on this / this is pending*, never *this is on brand*.

### Secondary — the signal set
- **Bull Green** (`#26a17b`): bullish bias, VALID state, LONG signals, passing gates, "ready" verdicts. Positive market meaning only.
- **Bear Red** (`#e5534b`): bearish bias, INVALID/stop-hit state, SHORT signals, failing gates. Negative market meaning only.
- **Caution Amber** (`#d9a441`): neutral/EXTENDED/"don't chase" states, delayed data, warnings, "wait" verdicts. The hesitation color.

### Neutral — the tonal chassis
- **Terminal Ink** (`#0e1117`): the app ground and sticky header; the deepest ambient field.
- **Panel** (`#161b22`): raised card and table-header surface — where content lives.
- **Inset** (`#0f141b`): recessed fills one step below panel — decision tiles, inputs, disclosure bodies, row hover.
- **Well** (`#0b0f15`): the deepest recess — code, confirm read-outs, the floating autocomplete.
- **Hairline** (`#272e3a`): every border and divider. The system's only line.
- **Text** (`#d7dde6`): primary reading text — a soft off-white, never pure `#fff`.
- **Text Muted** (`#8b97a7`): labels, metadata, secondary values, inactive tabs, "no data".

### Named Rules
**The Meaning-Only Color Rule.** Green, red, amber and blue are reserved for market meaning — bullish, bearish, caution, interactive. If something is colored, it is because it carries state. Never use a signal color for decoration, branding, or emphasis-for-its-own-sake. The rarity is the point: a splash of green on a dark grid must always *mean* something.

**The Tonal Depth Rule.** Surfaces get darker as they recede — `terminal-ink → panel → inset → well`. The four greys and the hairline do all the structural work, which is exactly what keeps the four signal colors rare and legible.

**The Soft-White Rule.** Primary text is `#d7dde6`, never `#ffffff`. Pure white on near-black vibrates and fatigues; the off-white reads calmer over a long session.

### Themes

**Dark is the product, light is an option.** The OS `prefers-color-scheme` is deliberately *not* consulted: a trading terminal should not repaint itself because someone's laptop is in light mode. A header toggle sets `data-theme="light"` on the root, persisted per browser and applied by an inline script before first paint so there is no flash. Only tokens are redefined — no component rule knows a theme exists.

The light palette is not the dark one inverted. Signal hues are darkened for legibility on light surfaces (`#26a17b` green reads at 2.4:1 on white and would fail as text; light mode uses `#0d7a56`), and the tonal stack runs the other way — `#eef1f5` ground, white panels, `#f4f6f9` inset.

**The AA Floor.** Every text/surface pairing in both themes measures **≥4.5:1** (dark min 4.60, light min 4.67). This forced one correction to the original palette: `#3b82f6` label text on the `#1c2740` accent fill — the **ARMED** state badge and the **Good** confidence badge — measured **4.04:1**, below the floor this document already required. The interactive hue is unchanged everywhere it carries meaning (focus rings, borders, active affordances); only the label *inside* an accent fill is lifted to `--interactive-on-fill` `#5c98f8` (5.2:1).

## Typography

**UI Font:** system sans (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto`)
**Data Font:** system mono (`ui-monospace, SFMono-Regular, Menlo`) for prices, levels, and read-outs.

**Character:** No typographic personality is imported — the native OS sans keeps the tool feeling like part of the operating system, fast and familiar, while the monospaced data font signals "these are numbers you can trust and compare." The expressiveness is in the *data*, not the letterforms.

### Hierarchy
- **Symbol** (700, 20px, line-height 1.1): the active ticker read-out (`.sym`) — the single largest element on any screen; the thing you're looking at.
- **Title** (600, 14px): card and section headings (`h2`), each often trailed by an 11px muted `small` sub-label that states the section's method.
- **Body** (400, 13px, line-height 1.45): default reading text, disclosure prose, list items.
- **Data** (400, 12px, `font-variant-numeric: tabular-nums`): all prices, entries, stops, targets, R:R, countdowns — monospaced or tnum-locked so digits align in columns.
- **Label / Overline** (700, 10–11px, letter-spacing 0.4–0.5px, UPPERCASE, muted): tile keys (`.dk`), section eyebrows (`.scan-head`), badge text. The quiet scaffolding that names things without shouting.

### Named Rules
**The Tabular Numbers Rule.** Every price, level, ratio, and countdown uses `tabular-nums` (or the mono data font). Digits must align vertically in tables and must not shift width as a live value ticks — a jittering last-traded price is a defect, not a detail.

**The Method-in-the-Subhead Rule.** A section title states *what*; its muted `small` sub-label states *how* (e.g. "· active chart · intraday decision metrics"). The method is always one glance away — the Analyst's Desk showing its work.

## Layout

A centered two-column CSS grid, `gap: 12px`, `padding: 12px 16px`. Cards default to one column; wide/primary panels take `.span2` (full width).

**Two shell widths, by content type.** Data views run to `--shell: 1760px`; prose-led views (Start Here) stay at `--shell-narrow: 1280px`. This *amends* the original single 1280px cap, and deliberately: at 1280px a 13-column scanner squeezed the rationale column to its 220px minimum, which wrapped it to six or seven lines and pushed rows to **134px** — the cap was buying whitespace at the cost of the density it was written to protect. Widening the data shell (with the rationale clamped to two lines) took the same 34 setups from a 4,906px page to 1,230px. The rule's intent — *this is an instrument, not a landing page* — is now enforced by keeping **prose** at a book measure rather than by capping the **grid**.

**The masthead is two sticky rails:** identity + live status on top, tab navigation below. A single combined row wrapped to three lines by 1100px and stood **257px tall on a 375px phone** — a third of the viewport, permanently sticky; the split rails hold at 78px desktop / 76px mobile, and the nav rail scrolls sideways rather than wrapping. Hairline separators (`.tabgap`) group the twelve tabs into orientation · live signals · analysis · idea scans · journal · utility.

**The first column pins too.** `th:first-child` / `td:first-child` are `position: sticky; left: 0` with a hairline seam. A 14-column scanner cannot fit a phone or a tablet, and without a pinned symbol you end up reading a row of entry/stop/target numbers with no idea whose they are. Hairline, not shadow, per the Hairline Rule.

**Table headers pin to their wrapper.** `.tpo-tablewrap` is the scroll region (`overflow: auto`, capped at `calc(100dvh - header - 170px)`) and `th` is `position: sticky; top: 0` inside it. The earlier arrangement — `overflow-x: auto` with `th { top: 0 }` aimed at the page — never pinned anything, because a horizontally-scrolling wrapper is already a scroll container on both axes (and `overflow-y: clip` is no escape: beside a scrolling x-axis it computes to `hidden`). The height cap only engages on tables that are actually long; a six-row analysis table never reaches it.

Density is deliberately high — 12px card padding, 6–8px internal gaps, 4px table cell padding, 46px scanner rows. Responsive: **≤1100px** collapses to a single column and `.span2` stops spanning; **≤820px** tightens page and card padding; **≤560px** drops the filter bar to two columns and the tile grids to two-up. This is a desktop-first instrument that stays usable on a phone, not a mobile-first app.

## Elevation & Depth

**Flat by default; depth is tonal.** The system uses essentially no shadows. Separation comes from the four-step grey stack (`terminal-ink → panel → inset → well`) plus 1px hairline borders. A card is not "lifted" — it is a lighter rectangle with an edge.

### Shadow Vocabulary
- **Floating overlay** (`box-shadow: 0 10px 28px #0009`): the *only* shadow in the system, reserved for the autocomplete dropdown (`.pat-suggest`) — genuinely floating UI that must read as above the page.

### Named Rules
**The Flat-By-Default Rule.** Resting surfaces cast no shadow. A shadow is permitted only on UI that truly floats above the document (menus, popovers). If it sits in the layout, it gets a hairline, not a shadow.

## Shapes

Tight, rectangular, terminal geometry. The radius scale climbs with surface size: micro badges **5px** (`.setup`, `.cat`), controls and inline chips **6px** (buttons, inputs, tabs, state badges, table-cell tags), mid surfaces **8px** (decision tiles, disclosures, the circuit block, the autocomplete), cards **10px**, and fully-round **999px** pills for status chips and toggles. Every surface is outlined by a single 1px hairline (`#272e3a`); there is no thick border, no double stroke, no decorative clipping. Corners stay small — this is instrumentation, not a consumer app, and the restraint reads as precision.

### Named Rules
**The Hairline Rule.** One border weight system-wide: 1px, `--hairline`. Structure is drawn with light, even lines — never with weight, color, or shadow.

## Components

### Naming

Component classes are named for **what the component is**, never for the tab that first needed it. The sheet had grown the other way — eleven of the twelve tabs styled their tables with `.tpo-table` and their disclosures with `.tpo-how`, which reads as if those tabs were borrowing the TPO scanner's styles rather than sharing a system. Current names: `.dtable` · `.tablewrap` · `.toolbar` · `.disclosure` (`-body`, `-note`, `-trade`) · `.metaline` · `.readout` · `.table-state` · `.statstrip` · `.state-block` · `.filterbar` · `.combo` · `.suggest` · `.text-input`. Element **ids** still carry a tab prefix (`#tpo-body`, `#utpo-meta`) — there they are identity, not styling.

### Buttons
- **Shape:** 6px radius (`{rounded.sm}`), 1px hairline border.
- **Default:** `control` face (`#1f2733`), `text` label, padding `5px 11px`. The compact `.btn-confirm` variant runs `3px 9px` at 11px for in-table actions.
- **Hover:** border shifts to Interactive Blue (`#3b82f6`); fill unchanged — the affordance is the edge, not a color wash.
- **Disabled:** opacity 0.5, `not-allowed` cursor. No color change (would read as a false signal).

### Pills (status & toggles)
- **Style:** 999px, `panel` fill, hairline border, muted text, 12px. Carry live status (`CDP up`, `updated 09:57`, countdowns) and inline checkbox toggles.
- **State:** `.ok` → Bull Green text + green-tinted border; `.bad` → Bear Red text + red-tinted border. Status color follows the Meaning-Only rule.

### Cards / Containers
- **Corner:** 10px. **Background:** `panel` (`#161b22`). **Border:** 1px hairline. **Shadow:** none (see Elevation). **Padding:** 12px (10px ≤480px).
- Each card leads with a `title` + method sub-label; analysis cards carry a "How it works" disclosure and an honest empty state.

### Inputs / Fields
- **Style:** `inset` fill (`#0f141b`), 1px hairline, 6px radius, 13px. Symbol search is a combobox with a shadowed `.pat-suggest` listbox.
- **Focus:** border to translucent blue (`#4c8dff77`), outline removed. Calm, not glowing.

### Navigation (tabs)
- **Style:** transparent, muted text, 12px, 36px tall, square. **Hover:** `inset` fill, text brightens to `text`. **Active:** a 2px Interactive Blue **underline** + `text` + 600 weight.
- **Why an underline, not a chip:** a filled active chip made the chrome the brightest object on a rail of twelve, competing with the data below. The underline marks position while keeping the rail visually flat.
- **Mobile:** the rail scrolls horizontally (`flex-wrap: nowrap`, hidden scrollbar); no hamburger and no wrapping — every surface stays one tap away without the nav eating the viewport.

### Signal State badge (signature)
The system's defining component. A 6px, 11px/700 tag whose fill+text encode the plan's live state, each on its own tinted well: **VALID** (green `#10261f`/`#26a17b`) · **ARMED** (blue `#1c2740`/`#3b82f6`) · **EXTENDED** (amber `#2a2410`/`#d9a441`) · **TARGET** (teal `#122a2a`/`#3fb6a8`) · **INVALID** (red `#2a1716`/`#e5534b`) · **EXPIRED** (grey `#20242c`/muted). The state *is* the instruction — the badge tells you whether to act.

### Decision tile (signature)
A responsive grid (`auto-fit minmax(180px, 1fr)`) of `inset` tiles, each an uppercase micro-label (`.dk`) over a value (`.dv`), with `good`/`bad`/`warn` variants coloring the value and adding a 2px inset left rail in the signal color. Used for the Signal Summary read and the Start Here setup status — the "instrument cluster" of the terminal. `auto-fit` (not `auto-fill`) so a three-tile panel fills its row instead of clustering into narrow columns on the left of a wide card.

### Stat strip (signature)
The scan header: a single hairline-divided row of label-over-value cells (`.sk` 10px caps / `.sv` 13px semibold tabular), led by a pulsing feed dot (`live` green / `delayed` amber / `closed` muted) and closed by a right-aligned timestamp. It replaces a flat run of equal-weight tags in which `universe 3150` read as loudly as `setups 31`; the ordering is now **what you act on first** (feed · setups · actionable · long/short), then context. Shared by both TPO scanners and both breakout scanners, so the four scan tabs are read the same way.

### State block (empty · loading · error)
The one vocabulary for "there is nothing here, and here is the honest reason": a dashed-hairline `inset` panel with a glyph, a `text`-weight title, and a ≤52ch explanation — `err` (solid red) and `warn` (solid amber) variants for failures and partial results. It occupies the space the data would have taken, so the layout does not collapse and an honest "no data" reads as an answer rather than as a caption. Inside a table it renders through a full-width `colspan` cell; skeleton rows (`.skel`, shimmering, disabled under `prefers-reduced-motion`) stand in while a multi-thousand-name universe scan is in flight.

### Filter bar
A wrapping flex row of label-over-control cells on the shared 28px control height, in an `inset` well, with the "N of M shown" count and **Reset** riding the trailing edge. Client-side only — it narrows rows already fetched and never triggers a provider request, and selections persist per tab in `localStorage` so a filter survives an auto-refresh cycle.

### "How it works" disclosure (signature)
A `<details>` panel (`inset` fill, 8px, custom ▸/▾ marker) holding method prose, closed by a dashed-top caveat note (`.tpo-how-note`). This is the Analyst's Desk made literal: the methodology and its honest limits are always one click away, never hidden and never overstated.

## Do's and Don'ts

### Do:
- **Do** keep every color strictly semantic — green/red/amber = market state, blue = interactive. If you reach for color, it must carry meaning (The Meaning-Only Color Rule).
- **Do** render all numeric data with `tabular-nums` or the mono data font, so live values align and never jitter.
- **Do** convey depth with the four-grey tonal stack + 1px hairlines; keep resting surfaces flat.
- **Do** pair every analysis surface with a "How it works" disclosure and an honest empty / "no data" state — transparency is a component, not an afterthought.
- **Do** right-align numeric table columns and left-align labels; keep tables horizontally scrollable rather than shrinking the type.
- **Do** use soft off-white `#d7dde6` for primary text, never pure white.

### Don't:
- **Don't** introduce a decorative or brand accent color; there is no non-semantic hue in this system.
- **Don't** name a component class after the tab that first needed it, and don't hardcode a color, spacing or radius in a component rule — every value comes from a token, which is what makes the light theme a single block of overrides.
- **Don't** let the OS color-scheme flip the product; light mode is an explicit, persisted user choice.
- **Don't** put drop shadows on resting cards, tiles, or badges — shadow is reserved for truly floating overlays.
- **Don't** fabricate numbers, states, testimonials, or performance to fill a panel — a truthful "no data" is the correct design (product invariant).
- **Don't** let primary text or state colors fall below WCAG AA contrast on `panel`/`terminal-ink`; density must never cost legibility.
- **Don't** trade tabular density for marketing whitespace — this is an instrument, not a landing page. Prose columns stay at a book measure (`--shell-narrow`, ~1280px / 88ch); the *data* grid may run to `--shell` (1760px) where the extra width buys columns rather than padding.
