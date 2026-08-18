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

A centered two-column CSS grid, `max-width: 1280px`, `gap: 12px`, `padding: 12px`. Cards default to one column; wide/primary panels take `.span2` (full width). The masthead is a sticky flex bar (brand · tab nav · live status pills). Table headers are sticky within horizontally-scrollable wrappers (`.tpo-tablewrap { overflow-x: auto }`) so dense tables never break the page's vertical rhythm.

Density is deliberately high — 12px card padding, 6–8px internal gaps, 6px table cell padding — but the two-column max-width and generous line-height keep it readable, not cramped. Responsive: **≤820px** collapses to a single column and `.span2` stops spanning; **≤480px** tightens page padding to 8px and card padding to 10px. This is a desktop-first instrument that stays usable on a phone, not a mobile-first app.

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
- **Style:** transparent, muted text, 6px radius, 12px. **Hover:** text brightens to `text`. **Active:** `panel` fill + hairline border + `text`. The active tab looks like a raised chip of the page surface.
- **Mobile:** the tab row wraps (`flex-wrap`); no hamburger — every surface stays one tap away.

### Signal State badge (signature)
The system's defining component. A 6px, 11px/700 tag whose fill+text encode the plan's live state, each on its own tinted well: **VALID** (green `#10261f`/`#26a17b`) · **ARMED** (blue `#1c2740`/`#3b82f6`) · **EXTENDED** (amber `#2a2410`/`#d9a441`) · **TARGET** (teal `#122a2a`/`#3fb6a8`) · **INVALID** (red `#2a1716`/`#e5534b`) · **EXPIRED** (grey `#20242c`/muted). The state *is* the instruction — the badge tells you whether to act.

### Decision tile (signature)
A responsive grid (`auto-fill minmax(150px, 1fr)`) of `inset` tiles, each an uppercase micro-label (`.dk`) over a value (`.dv`), with `good`/`bad`/`warn` variants coloring the border + value. Used for the Signal Summary read and the Start Here setup status — the "instrument cluster" of the terminal.

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
- **Don't** put drop shadows on resting cards, tiles, or badges — shadow is reserved for truly floating overlays.
- **Don't** fabricate numbers, states, testimonials, or performance to fill a panel — a truthful "no data" is the correct design (product invariant).
- **Don't** let primary text or state colors fall below WCAG AA contrast on `panel`/`terminal-ink`; density must never cost legibility.
- **Don't** widen the container past ~1280px or trade the tabular density for marketing whitespace — this is an instrument, not a landing page.
