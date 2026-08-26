# HR Copilot AI — Dark Mode Design System

A read-only extraction of the visual system as it exists in this repository, intended
for reuse in future projects. Every value below was taken from the source; nothing here
is invented, adjusted or idealised.

Extracted 2026-08-26 from `~/Desktop/hr-copilot-ai/frontend`.

---

## 1. Theme architecture

**One stylesheet, two class-scoped token blocks. No Tailwind config file exists.**

| Concern | Location |
|---|---|
| All design tokens (light + dark) | `app/globals.css` (582 lines) |
| Tailwind v4 token bridge | `app/globals.css` → `@theme inline { … }` |
| Theme state, storage, boot script | `lib/theme/theme.ts` |
| Boot script injection | `app/layout.tsx` |
| Theme toggle UI | `components/layout/Header.tsx` (sun/moon control) |

### How dark mode is activated

Tailwind v4 is used with `@import "tailwindcss"` — there is **no `tailwind.config.js`**.
Colours are declared as CSS custom properties and exposed to Tailwind through an
`@theme inline` block, so `bg-surface`, `text-ink`, `border-line` etc. are *generated
from the variables*.

- Light lives on `:root`.
- Dark lives on **`.theme-dark`** (a class on `<html>`, **not** `data-theme`, and **not**
  Tailwind's default `dark:` variant).
- There is deliberately **no `@media (prefers-color-scheme: dark)` block.** The comment in
  the source explains why: a media query would be a second copy of ~40 values that could
  silently drift. Instead a synchronous boot script resolves the system preference
  *before first paint* and always writes an explicit class.

```js
// lib/theme/theme.ts — runs in <head>, synchronously
(function () {
  var e = document.documentElement;
  try {
    var s = localStorage.getItem("hrc-theme");
    var d = s === "dark" || (s !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    e.classList.remove("theme-light", "theme-dark");
    e.classList.add(d ? "theme-dark" : "theme-light");
  } catch (x) { e.classList.add("theme-light"); }
})();
```

### Persistence

- **`localStorage` key `hrc-theme`**, values `"light" | "dark" | absent`.
- Three states, two classes: absent means "no choice", resolved at boot from the OS.
- **Deliberately not a cookie** — the source notes a cookie would ship on every API
  request and need reconciling with the session, and nothing server-side uses the theme.
- Consequence: the server renders theme-less markup; without JS the product renders in
  **light**, which the source describes as "a complete design rather than a broken one".
- Cross-tab sync via a `storage` listener plus a custom `hrc:theme` event;
  `useSyncExternalStore` reads **the DOM class**, not React state, so the toggle can never
  disagree with what is on screen.

### Where colour comes from

Essentially **100% CSS variables**. See §16 — the hardcoded-colour debt is 3 real values
in the whole app, all legitimately outside the theme.

---

## 2. Master dark palette

**28 unique colour values** across **40 colour-valued custom properties**
(44 dark properties total, including sizes and motion).

Defined in `app/globals.css` under `.theme-dark`.

### Surfaces

| Design role | Hex | RGB | CSS variable | Tailwind class | Where used |
|---|---|---|---|---|---|
| Page background | `#060e1c` | `6 14 28` | `--page`, `--canvas` | `bg-canvas` | `body` |
| Card / primary surface | `#0b162a` | `11 22 42` | `--surface` | `bg-surface` | `Card`, header, bottom nav |
| Nested / muted surface | `#101f3a` | `16 31 58` | `--surface-muted`, `--surface-raised` | `bg-surface-muted` | table headers, nested panels, ghost hover |
| Elevated (deeper than card) | `#081326` | `8 19 38` | `--elevated` | `bg-elevated` | rarely used; deeper-than-card wells |
| Accent soft background | `#11264e` | `17 38 78` | `--brand-soft`, `--accent-soft` | `bg-brand-soft` | brand badges, active nav item |
| Neutral soft background | `#101e36` | `16 30 54` | `--neutral-soft` | `bg-neutral-soft` | neutral badges |
| AI surface tint | `#101c33` | `16 28 51` | `--ai-tint` | `bg-ai-tint` | generated-content panels |

> **Note on "modal / popover background":** there is no distinct modal token. Dialogs reuse
> `bg-surface` (`#0b162a`) with `border-line` and `shadow-pop`. Depth comes from the scrim
> and shadow, not a different fill.

> **Note on "sidebar":** there is **no sidebar** in this product. Navigation is a sticky top
> bar on desktop and a fixed bottom bar on mobile.

### Text

| Design role | Hex | CSS variable | Tailwind class |
|---|---|---|---|
| Primary text | `#f0f6ff` | `--ink`, `--text` | `text-ink` |
| Secondary / muted text | `#a2b3cd` | `--ink-muted`, `--text-muted` | `text-ink-muted` |
| Subtle text / placeholder | `#6e82a0` | `--ink-subtle` | `text-ink-subtle` |
| Inverted (on accent fills) | `#060e1c` | `--ink-inverted` | `text-ink-inverted` |

> **Disabled text** has no token. Disabled state is expressed as **opacity**:
> `disabled:opacity-55` on buttons, `disabled:opacity-60` on inputs.

### Borders

| Design role | Hex | CSS variable | Tailwind class |
|---|---|---|---|
| Default border / divider | `#1c3054` | `--border`, `--line` | `border-line`, `divide-line` |
| Strong / hover border | `#294470` | `--line-strong` | `border-line-strong` |
| AI border | `#2b3a63` | `--ai-line` | `border-ai-line` |

### Accent (blue)

| Design role | Hex | CSS variable | Tailwind class |
|---|---|---|---|
| Primary accent | `#4285ff` | `--brand`, `--primary`, `--ring` | `bg-brand`, `text-brand`, `ring-ring` |
| Accent hover | `#609aff` | `--brand-hover`, `--primary-hover` | `hover:bg-brand-hover` |
| Accent soft bg | `#11264e` | `--brand-soft` | `bg-brand-soft` |
| Accent ink (text on soft) | `#96beff` | `--brand-ink` | `text-brand-ink` |

> **Accent active** has no separate token — active/pressed is expressed via the
> `.btn-raised` gradient and shadow (§12), not a third blue.
> **Link colour** is `text-brand` / `hover:text-brand`; there is no dedicated link token.

### Semantic status

| Role | Foreground | Soft background | Variables |
|---|---|---|---|
| Success | `#34d399` | `#0a2926` | `--positive` / `--positive-soft` |
| Warning | `#fbbf5a` | `#2a2113` | `--warning` / `--warning-soft` |
| Error / danger | `#fb7185` | `#2c1622` | `--critical`, `--danger` / `--critical-soft` |
| Info | `#7aa7f8` | `#0f1f3a` | `--info` / `--info-soft` |
| AI / generated | `#a99dff` | `#101c33` | `--ai-ink` / `--ai-tint` |

Note the semantic foregrounds are **light-on-dark** in dark mode (mint, amber, rose) —
the inverse of the light theme's deep `#047857` / `#b45309` / `#be123c`.

### Ambient / decoration

| Role | Value | Variable |
|---|---|---|
| Background grid line | `rgb(66 133 255 / 0.07)` | `--grid-color` |
| Grid cell size | `32px` | `--grid-size` |
| Ambient glow (blue) | `rgb(66 133 255 / 0.20)` | `--ai-glow` |
| Ambient glow (violet) | `rgb(124 108 246 / 0.16)` | `--ai-glow-warm` |

---

## 3. Background hierarchy

The system separates depth by **temperature and a 1px border**, not by shadow. In dark
mode the ladder runs *darkest page → lighter surfaces*, the opposite of the light theme.

| Level | Role | Dark value | Class | Real example |
|---|---|---|---|---|
| **0** | Page | `#060e1c` | `bg-canvas` | `body` in `app/globals.css` |
| **1** | Sticky header / bottom nav | `#0b162a` @ 80–95% + blur | `bg-surface/80`, `bg-surface/95` | `components/layout/Header.tsx`, `BottomNav.tsx` |
| **2** | Card | `#0b162a` | `bg-surface` | `components/ui/Card.tsx` |
| **3** | Nested panel / table header | `#101f3a` | `bg-surface-muted` | `components/ui/DataTable.tsx`, `MatchInsightSummary.tsx` |
| **3.5** | Half-strength nested | `#101f3a` @ 35–60% | `bg-surface-muted/35`, `/60` | `MatchInsightSummary.tsx`, `MatchEvidenceRefs.tsx` |
| **4** | Selected / accent surface | `#11264e` | `bg-brand-soft` | active `BottomNav` item, brand badges |
| **4-alt** | AI / generated surface | `#101c33` | `bg-ai-tint` | `AiInsightPanel` |

A distinctive detail: level 3.5 (`/35`, `/40`, `/60` alpha on `surface-muted`) is used
heavily — it produces a panel that is *slightly* separated from its card without
introducing another opaque colour.

---

## 4. Text hierarchy

| Role | Class | Dark value | Typical size |
|---|---|---|---|
| Primary | `text-ink` | `#f0f6ff` | 13–17px |
| Secondary | `text-ink-muted` | `#a2b3cd` | 12.5–13px |
| Muted / meta | `text-ink-subtle` | `#6e82a0` | 11–12px |
| Placeholder | `placeholder:text-ink-subtle` | `#6e82a0` | — |
| Disabled | *(no token)* `disabled:opacity-60` | — | — |
| Link | `text-brand` / `hover:text-brand` | `#4285ff` | — |
| On accent soft | `text-brand-ink` | `#96beff` | — |
| Success | `text-positive` | `#34d399` | — |
| Warning | `text-warning` | `#fbbf5a` | — |
| Error | `text-critical` | `#fb7185` | — |
| AI | `text-ai-ink` | `#a99dff` | — |
| On accent fill | `text-white` | `#ffffff` | — |

Type sizes are almost always **explicit bracket values** (`text-[13px]`, `text-[12.5px]`,
`text-[11.5px]`) rather than Tailwind's scale — a deliberate dense-UI choice.

Font: `--font-geist-sans` with `font-feature-settings: "cv02","cv03","cv04","cv11"`.

---

## 5. Borders

| Role | Class | Dark value |
|---|---|---|
| Default | `border-line` | `#1c3054` |
| Hover / strong | `border-line-strong` | `#294470` |
| Accent | `border-brand/20`, `/25`, `/30` | `#4285ff` at 20–30% |
| Error | `border-critical` (+ `/30`) | `#fb7185` |
| Success | `border-positive/20`, `/30` | `#34d399` |
| Warning | `border-warning/20`, `/30` | `#fbbf5a` |
| Info | `border-info/20` | `#7aa7f8` |
| AI | `border-ai-line` | `#2b3a63` |

**Global default:** `@layer base { * { border-color: var(--line); } }` — every element's
border colour defaults to the theme line, so components only specify width.

**Widths:** effectively always `1px` (`border`, `border-b`, `border-t`). No 2px borders;
emphasis is a *colour* change, not a *width* change.

**Radius patterns:**

| Element | Radius |
|---|---|
| Card | `rounded-xl` (12px) |
| Nested panel / evidence card | `rounded-lg` (8px) |
| Input / select | `rounded-[10px]` |
| Button | `rounded-lg` |
| Badge | `rounded-md` (6px) |
| Chip / pill / band chip | `rounded-full` |
| Modal | `rounded-[16px]` |
| Focus ring | `border-radius: 0.5rem` on `:focus-visible` |

**Opacity convention:** soft-tinted surfaces use `/35`–`/60`; accent borders use `/20`–`/30`.

---

## 6. Accent system

The accent is a **single blue with one hover step**. There is no third "active" blue —
pressed/raised state is carried by gradient and glow instead.

```
#4285ff  brand / ring          →  fills, rings, active icons
#609aff  brand-hover           →  hover fill
#11264e  brand-soft            →  selected surfaces, soft badges
#96beff  brand-ink             →  text on brand-soft
```

Dark mode adds a gradient ramp for the primary CTA (light mode does not have one):

```css
.theme-dark .btn-raised {
  background-image: linear-gradient(180deg, #609aff 0%, #4285ff 100%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.14),
              0 4px 18px -6px rgb(66 133 255 / 0.55);
}
.theme-dark .btn-raised:hover {
  background-image: linear-gradient(180deg, #7aabff 0%, #5793ff 100%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.18),
              0 6px 22px -6px rgb(124 115 255 / 0.7);
}
```

`#7aabff`, `#5793ff` and `rgb(124 115 255)` appear **only** here — they are gradient stops,
not tokens.

**A defining decision:** the AI accent stays **violet** (`#a99dff`) while the product is
blue. The source states this explicitly — blue is the product's colour, violet means
"a model produced this", so a generated panel is distinguishable at a glance.

---

## 7. Button states

`components/ui/Button.tsx`

**Base (all variants):**
```
transition-[background-color,box-shadow,border-color,color]
duration-[var(--motion-fast)] ease-[var(--ease-out)]
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
focus-visible:ring-offset-2 focus-visible:ring-offset-surface
disabled:pointer-events-none disabled:opacity-55
```

| Variant | Default | Hover | Focus | Disabled |
|---|---|---|---|---|
| **primary** | `.btn-raised bg-brand text-white` → gradient `#609aff→#4285ff`, white text | gradient `#7aabff→#5793ff` + stronger bloom | 2px `#4285ff` ring, offset 2, offset-colour `bg-surface` | opacity 55%, pointer-events none |
| **secondary** | `bg-surface #0b162a`, `text-ink`, `border-line #1c3054` | `border-line-strong #294470` + `bg-surface-muted #101f3a` | same ring | opacity 55% |
| **ghost** | transparent, `text-ink-muted` | `bg-surface-muted` + `text-ink` | same ring | opacity 55% |
| **danger** | `bg-critical #fb7185`, `text-white` | `brightness-95` | same ring | opacity 55% |

Sizes: `sm h-8 px-3 text-[13px]` · `md h-9.5 px-4 text-sm` · `lg h-11 px-5 text-sm`.

**Not present:** no `outline` variant (secondary fills that role), no `success` variant,
no dedicated icon-button variant — icon buttons are `ghost` with padding.

**No `:active` styles anywhere.** Press feedback is the hover state plus the 150ms
transition.

The focus ring's `ring-offset-surface` is worth copying: the offset ring is painted in the
*card* colour, so the accent ring never merges with the control's own border.

---

## 8. Form states

`components/ui/Field.tsx`

**Input / textarea / select base:**
```
w-full rounded-[10px] border bg-surface px-3 text-sm text-ink
placeholder:text-ink-subtle
transition-[border-color,box-shadow] duration-[var(--motion-fast)]
focus:outline-none focus:ring-[3px] focus:ring-brand/15
disabled:cursor-not-allowed disabled:opacity-60
```

| State | Border | Ring | Notes |
|---|---|---|---|
| Default | `border-line #1c3054` | — | fill `bg-surface #0b162a` |
| Hover | `border-line-strong #294470` | — | |
| Focus | `border-brand #4285ff` | `ring-[3px] ring-brand/15` | **3px soft ring, not the 2px outline** |
| Error | `border-critical #fb7185` | `focus:ring-critical/15` | message `text-critical` |
| Disabled | inherited | — | `opacity-60`, `cursor-not-allowed` |
| Success | *(none)* | — | no success state on inputs |

- **Label:** `text-[13px] font-medium text-ink`; required marker `text-critical`.
- **Hint:** `text-[12.5px] text-ink-muted`.
- **Error:** `text-[12.5px] text-critical`, `role="alert"`.
- **Checkbox/radio:** `size-4 rounded border-line-strong accent-[var(--brand)]` — native
  controls tinted with CSS `accent-color`, not custom-drawn.
- **Select:** `h-9.5 appearance-none pr-8 bg-no-repeat` with a background-image chevron.
- **Search:** an `input[type=search]` with a `text-ink-subtle` icon absolutely positioned
  at `left-3`.

Note inputs focus with a **3px `brand/15` ring**, whereas buttons use the global **2px
solid `ring-ring`**. Two deliberately different focus treatments for two densities.

---

## 9. Navigation

**No sidebar exists.** Desktop = sticky top bar; mobile = fixed bottom bar.

### Desktop top nav — `components/layout/Header.tsx`, `components/layout/TopNav.tsx`

| Element | Dark treatment |
|---|---|
| Bar background | `bg-surface/80` + `backdrop-blur-md backdrop-saturate-150` |
| Bottom border | `border-b border-line` |
| Position | `sticky` |
| Inactive item | `text-ink-muted` |
| Active item | `text-ink` + brand underline indicator |
| Hover | `bg-surface-muted/60` |
| Logo mark | `bg-brand` tile |
| Focus | `ring-2 ring-inset ring-ring` |

### Mobile bottom nav — `components/layout/BottomNav.tsx`

| Element | Dark treatment |
|---|---|
| Bar background | `bg-surface/95` + `backdrop-blur-md` |
| Top border | `border-t border-line` |
| Active item | `bg-brand-soft #11264e` + `text-brand-ink #96beff` |
| Inactive item | `text-ink-subtle #6e82a0` |
| Label size | `text-[10.5px]` |
| Position | `fixed bottom-0` |

### Dropdown / menu

`bg-surface` + `border-line` + `shadow-pop`, `rounded-xl`; items
`text-[13px] text-ink-muted hover:bg-surface-muted hover:text-ink`, `role="menuitem"`.

### Command palette ("Quick navigation", ⌘K)

Same surface treatment as the dropdown, over a `bg-ink/45 backdrop-blur-[2px]` scrim.

---

## 10. Cards / tables / lists

### Card — `components/ui/Card.tsx`
```
min-w-0 rounded-xl border border-line bg-surface shadow-card
```
Header: `flex items-start justify-between gap-3 border-b border-line px-4 py-3`.

### Interactive card — `.card-interactive` in `globals.css`
```css
:hover { border-color: var(--line-strong);
         box-shadow: var(--shadow-raised);
         transform: translateY(-1px); }
```
Border + 1px lift only. The source is explicit: *no scale, no colour shift, nothing that
moves surrounding content.*

### Table — `components/ui/DataTable.tsx`

| Part | Treatment |
|---|---|
| Container | `bg-surface`, `border-line`, `border-collapse` |
| Header row | `bg-surface-muted` / `bg-surface-muted/60` |
| Header text | `text-ink-subtle`, uppercase, `text-[11px]` |
| Row divider | `border-b border-line`, last row `border-b-0` |
| Cell text | `text-ink` / `text-ink-muted` |

### Selected state

`bg-brand-soft` + `border-brand/25` (match list rows, active nav, selected chips).

---

## 11. Match / status colours

### Score bands — `components/candidate/ui/MatchScore.tsx`

| Band | Ring | Chip |
|---|---|---|
| `strong` | `text-positive #34d399` | `border-positive/30 bg-positive-soft text-positive` |
| `good` | `text-brand #4285ff` | `border-brand/25 bg-brand-soft text-brand-ink` |
| `partial` | `text-warning #fbbf5a` | `border-warning/30 bg-warning-soft text-warning` |
| `unknown` | `text-ink-subtle #6e82a0` | `border-line bg-surface-muted text-ink-muted` |

The ring track is `text-line`; the centred number is `text-ink` `tabular-nums`.

### Eligibility — `lib/match/presentation.ts`

| State | Tone | Glyph |
|---|---|---|
| `ELIGIBLE` | `positive` | `✓` |
| `PARTIAL` | `warning` | `~` |
| `BLOCKED` | `critical` | `!` |

### Requirement matrix status — `lib/match/presentation.ts`

| Status | Tone | Glyph | Meaning |
|---|---|---|---|
| `STRONG` | `positive` | `✓✓` | ≥2 independent current sources |
| `MATCH` | `positive` | `✓` | evidenced once, or profile-stated |
| `PARTIAL` | `warning` | `~` | ambiguous, or transferable-only |
| `MISSING` | **`neutral`** | `—` | no current evidence found |
| `BLOCKED` | `critical` | `!` | eligibility conflict on this row |

> **The most important rule in this palette:** `MISSING` is **neutral, not red**. The
> source comment: *"an absence of current evidence is not an error and not a fault, and
> painting it red states something about the person that the data does not support."*
> `BLOCKED` is the only critical tone.

### Priority

| Priority | Tone | Glyph |
|---|---|---|
| `MUST_HAVE` | `brand` | `★` |
| `NICE_TO_HAVE` | `neutral` | `☆` |

### Career trajectory

`STRONG`/`ALIGNED` → `positive` · `MIXED` → `warning` · `WEAK`/`UNKNOWN` → `neutral`.

### Score delta

`> 0` → `positive` · `< 0` → `warning` (never critical) · `0` → `neutral`.

### Transferable evidence — `components/match/MatchInsightSections.tsx`
```
border-info/20 bg-info-soft/40   →  #7aa7f8 @20%, #0f1f3a @40%
```
Deliberately **info-toned, never positive-green**, so related experience is never
mistaken for a direct match.

### Contradictions
```
border-warning/20 bg-warning-soft/40   →  #fbbf5a @20%, #2a2113 @40%
```
Warning, never critical — a disagreement between two sources is not an accusation.

### Evidence confidence
No colour of its own. Rendered as a plain `text-ink` percentage beside a `HelpIcon` in
`text-ink-subtle`.

---

## 12. Badges / chips

### `Badge` — `components/ui/Badge.tsx`

Base: `inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px]
font-medium leading-5 whitespace-nowrap`

| Tone | Classes | Dark values |
|---|---|---|
| `neutral` | `bg-neutral-soft text-ink-muted border-line` | `#101e36` / `#a2b3cd` / `#1c3054` |
| `brand` | `bg-brand-soft text-brand-ink border-brand/20` | `#11264e` / `#96beff` / `#4285ff@20%` |
| `positive` | `bg-positive-soft text-positive border-positive/20` | `#0a2926` / `#34d399` |
| `warning` | `bg-warning-soft text-warning border-warning/20` | `#2a2113` / `#fbbf5a` |
| `critical` | `bg-critical-soft text-critical border-critical/20` | `#2c1622` / `#fb7185` |
| `info` | `bg-info-soft text-info border-info/20` | `#0f1f3a` / `#7aa7f8` |

The border is the detail worth copying — the source explains a pale pill dissolves into a
pale card without one, and deepening the fill instead "turns a status into a warning light".

### `Chip` (skills, keywords, vacancy names)
```
rounded-md border border-line bg-surface-muted px-2 py-0.5 text-[11.5px] text-ink-muted
hover:border-line-strong hover:text-ink
```

### Band chip (`MatchScore.tsx`)
`rounded-full border px-2 py-0.5 text-[11.5px] font-medium` + per-band classes (§11).

### Notification badge
Brand-filled count pill on the bell icon.

---

## 13. Shadows / effects

### Shadow tokens (dark values)

```css
--shadow-card:   0 1px 2px rgb(0 0 0 / 0.35);
--shadow-raised: 0 1px 2px rgb(0 0 0 / 0.4), 0 6px 20px -10px rgb(0 0 0 / 0.6);
--shadow-pop:    0 20px 48px -16px rgb(0 0 0 / 0.7), 0 2px 8px -4px rgb(0 0 0 / 0.5);
--shadow-glow:   0 0 0 1px rgb(66 133 255 / 0.22), 0 10px 34px -12px rgb(66 133 255 / 0.5);
```

Dark shadows are pure black at high alpha; light-mode shadows are blue-tinted
(`rgb(20 40 80 / …)`). Dark `shadow-pop` is markedly deeper (0.7 vs 0.18).

### Named effects

| Utility | Effect |
|---|---|
| `.ai-halo` | `box-shadow: var(--shadow-glow)` — 1px accent ring + blue bloom. Reserved for hero, AI CTA, strongest match. Never on text-heavy lists. |
| `.ai-edge` | 1px gradient hairline along a panel's top edge, `--ai-ink` fading out at both ends, `opacity: 0.5` |
| `.btn-raised` | inset white top hairline + drop shadow; dark mode adds the blue gradient ramp |
| `.spotlight` | mouse-follow radial `16rem` at `--spot-x/--spot-y`, opacity 0→1 on hover, **disabled under `prefers-reduced-motion`** |
| `.accent-panel` | `radial-gradient(120% 140% at 0% 0%, var(--ai-glow), transparent 62%)` over `--surface-raised` |
| `.footer-panel::before` | **dark only** — violet radial bled off the top edge |

### Backdrop blur

`backdrop-blur-md` + `backdrop-saturate-150` (header), `backdrop-blur-md` (bottom nav),
`backdrop-blur-[2px]` / `[3px]` / `-sm` (scrims).

### Overlay scrims

`bg-ink/45` (most common), `bg-ink/40`, `bg-ink/25`, `bg-black/45`.
In dark mode `--ink` is `#f0f6ff`, so **`bg-ink/45` is a *light* scrim in dark mode** —
a deliberate inversion. `bg-black/45` appears twice and is the inconsistent case (§16).

### Motion

```css
--motion-fast: 150ms;  --motion-base: 200ms;  --motion-slow: 250ms;
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);
```
Keyframes: `pop-in` (6px rise + 0.985 scale), `drawer-in` (1.5rem slide), `fade-in`,
`skeleton-shimmer`. A global `prefers-reduced-motion` block clamps all of it to `0.01ms`.

---

## 14. Background grid / decorations

**This is the signature of the theme and the most reusable single piece.**

### The grid — `body::before`

```css
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right,  var(--grid-color) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-color) 1px, transparent 1px);
  background-size: var(--grid-size) var(--grid-size);
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 45%, transparent 92%);
          mask-image: linear-gradient(to bottom, #000 0%, #000 45%, transparent 92%);
}
```

- **Line colour (dark):** `rgb(66 133 255 / 0.07)` — blue hairlines, under 7%.
- **Grid size:** `32px`.
- **Fixed**, so it never scrolls with content and never enters layout.
- **Masked** to fade out from 45% → 92% down the viewport, so long reading pages end on a
  plain surface instead of graph paper.

### The ambient wash — `body::after`

```css
body::after {
  content: "";
  position: fixed;
  inset: -10rem auto auto -10rem;   /* anchored off the top-left corner */
  width: 46rem; height: 34rem;
  z-index: 0; pointer-events: none;
  background:
    radial-gradient(50% 50% at 40% 30%, var(--ai-glow)      0%, transparent 70%),
    radial-gradient(45% 45% at 70% 55%, var(--ai-glow-warm) 0%, transparent 72%);
}
```

Two overlapping radials — blue `rgb(66 133 255 / 0.20)` and violet
`rgb(124 108 246 / 0.16)`. This blue-violet bloom is what stops the dark UI reading as flat.

**Content must sit above both:** `body > * { position: relative; z-index: 1; }`

### Per-page hero wash — `.ambient-hero`

Applied to signature pages via `className="ambient-hero"`:
```css
.ambient-hero::before {
  position: absolute;
  inset: -9rem -20% auto -20%;
  height: 30rem;
  background:
    radial-gradient(52% 60% at 42% 0%,  var(--ai-glow)      0%, transparent 68%),
    radial-gradient(45% 55% at 78% 12%, var(--ai-glow-warm) 0%, transparent 70%);
}
```
Used on `/job-matches`, `/candidates/[id]`, and other hero pages.

---

## 15. Interaction states

| State | Treatment |
|---|---|
| **Hover (button)** | `bg-brand-hover` / `bg-surface-muted` / `border-line-strong` |
| **Hover (card)** | `.card-interactive` — `border-line-strong` + `shadow-raised` + `translateY(-1px)` |
| **Hover (chip)** | `border-line-strong` + `text-ink` |
| **Hover (nav)** | `bg-surface-muted/60` |
| **Focus (global)** | `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 0.5rem; }` |
| **Focus (button)** | `ring-2 ring-ring ring-offset-2 ring-offset-surface` |
| **Focus (input)** | `border-brand` + `ring-[3px] ring-brand/15` |
| **Selected** | `bg-brand-soft` + `text-brand-ink` (+ `border-brand/25`) |
| **Pressed** | *no `:active` styles exist* |
| **Disabled** | `opacity-55` (button) / `opacity-60` + `cursor-not-allowed` (input); `pointer-events-none` |
| **Loading** | button `disabled` + spinner; panels show `role="status"` text |
| **Skeleton** | `.skeleton` — shimmer sweeping `surface-muted → line → surface-muted`, `200% 100%`, 1.4s infinite |
| **Selection** | `::selection { background: var(--brand-soft); color: var(--brand-ink); }` |

---

## 16. Hardcoded colour audit

**The codebase is exceptionally clean: 3 real hardcoded colours in application code.**

Counts across `app/`, `components/`, `lib/` (`.ts`/`.tsx`, excluding `globals.css`):

| Kind | Count |
|---|---|
| Hex literals | **8** (5 are test assertions) |
| `rgb()` / `hsl()` literals | **0** |
| Tailwind default-palette utilities | **2** |

### Intentional — leave as-is

| Value | Location | Why |
|---|---|---|
| `#ffffff` | `lib/pwa/config.ts:23` | PWA manifest `theme_color`; a manifest cannot read a CSS variable |
| `#0b162a` | `lib/pwa/config.ts:24` | PWA dark `theme_color` — mirrors `--surface` |
| `#f1f6fd` | `lib/pwa/config.ts:31` | PWA `background_color` — mirrors light `--page` |
| `#f1f6fd`, `#060e1c`, `#0b162a`, `#5a45d6`, `#a99dff` | `lib/theme/theme.test.ts:152-161` | Tests that pin the token values — literals are the point |

### One-off decoration

| Value | Location | Note |
|---|---|---|
| `from-amber-200 to-amber-400/80` | `components/plan/DemoCheckoutModal.tsx:272` | The fake chip on a mock credit card. Gold is the *point*; no theme token would be right |

### Candidate for tokenisation

| Value | Location | Note |
|---|---|---|
| `bg-black/45` | 2 occurrences in scrims | Every other scrim uses `bg-ink/45`. Since `--ink` inverts per theme, these two are the only scrims that don't. Low impact, but inconsistent |
| `#7aabff`, `#5793ff`, `rgb(124 115 255)` | `globals.css` `.theme-dark .btn-raised:hover` | Gradient stops with no variable. Fine inside the stylesheet, worth naming if reused |

### Structural note

Because Tailwind v4's `@theme inline` generates utilities *from* the variables, classes
like `bg-surface` and `text-ink` **are** the token system. There is no parallel palette to
drift from — which is why the debt is this small.

---

## 17. Normalized reusable tokens

Mapped **only** from values found in this project.

```css
/* ── Surfaces ────────────────────────────────────────────── */
--dark-bg-page:            #060e1c;   /* --page / --canvas          */
--dark-bg-surface:         #0b162a;   /* --surface (cards, header)  */
--dark-bg-card:            #0b162a;   /* same token in this system  */
--dark-bg-nested:          #101f3a;   /* --surface-muted / -raised  */
--dark-bg-elevated:        #081326;   /* --elevated                 */
--dark-bg-accent-soft:     #11264e;   /* --brand-soft               */
--dark-bg-neutral-soft:    #101e36;   /* --neutral-soft             */
--dark-bg-ai:              #101c33;   /* --ai-tint                  */

/* ── Text ────────────────────────────────────────────────── */
--dark-text-primary:       #f0f6ff;   /* --ink                      */
--dark-text-secondary:     #a2b3cd;   /* --ink-muted                */
--dark-text-muted:         #6e82a0;   /* --ink-subtle (+placeholder)*/
--dark-text-inverted:      #060e1c;   /* --ink-inverted             */

/* ── Borders ─────────────────────────────────────────────── */
--dark-border-default:     #1c3054;   /* --line                     */
--dark-border-strong:      #294470;   /* --line-strong              */
--dark-border-ai:          #2b3a63;   /* --ai-line                  */

/* ── Accent ──────────────────────────────────────────────── */
--dark-accent:             #4285ff;   /* --brand / --ring           */
--dark-accent-hover:       #609aff;   /* --brand-hover              */
--dark-accent-soft:        #11264e;   /* --brand-soft               */
--dark-accent-ink:         #96beff;   /* --brand-ink                */

/* ── Semantic ────────────────────────────────────────────── */
--dark-success:            #34d399;
--dark-success-soft:       #0a2926;
--dark-warning:            #fbbf5a;
--dark-warning-soft:       #2a2113;
--dark-danger:             #fb7185;
--dark-danger-soft:        #2c1622;
--dark-info:               #7aa7f8;
--dark-info-soft:          #0f1f3a;
--dark-ai:                 #a99dff;

/* ── Ambience ────────────────────────────────────────────── */
--dark-grid-line:          rgb(66 133 255 / 0.07);
--dark-grid-size:          32px;
--dark-glow-blue:          rgb(66 133 255 / 0.20);
--dark-glow-violet:        rgb(124 108 246 / 0.16);

/* ── Elevation ───────────────────────────────────────────── */
--dark-shadow-card:        0 1px 2px rgb(0 0 0 / 0.35);
--dark-shadow-raised:      0 1px 2px rgb(0 0 0 / 0.4), 0 6px 20px -10px rgb(0 0 0 / 0.6);
--dark-shadow-pop:         0 20px 48px -16px rgb(0 0 0 / 0.7), 0 2px 8px -4px rgb(0 0 0 / 0.5);
--dark-shadow-glow:        0 0 0 1px rgb(66 133 255 / 0.22), 0 10px 34px -12px rgb(66 133 255 / 0.5);
```

---

## 18. Tailwind reusable config

For a **Tailwind v3** project (this repo is v4 and has no config file, so this is a
translation, not a copy):

```js
// tailwind.config.js
module.exports = {
  darkMode: ["class", ".theme-dark"],
  theme: {
    extend: {
      colors: {
        dark: {
          page:     "#060e1c",
          surface:  "#0b162a",
          nested:   "#101f3a",
          elevated: "#081326",
          text: {
            primary:   "#f0f6ff",
            secondary: "#a2b3cd",
            muted:     "#6e82a0",
            inverted:  "#060e1c",
          },
          border: {
            DEFAULT: "#1c3054",
            strong:  "#294470",
            ai:      "#2b3a63",
          },
          accent: {
            DEFAULT: "#4285ff",
            hover:   "#609aff",
            soft:    "#11264e",
            ink:     "#96beff",
          },
          success: { DEFAULT: "#34d399", soft: "#0a2926" },
          warning: { DEFAULT: "#fbbf5a", soft: "#2a2113" },
          danger:  { DEFAULT: "#fb7185", soft: "#2c1622" },
          info:    { DEFAULT: "#7aa7f8", soft: "#0f1f3a" },
          ai:      { DEFAULT: "#a99dff", tint: "#101c33" },
        },
      },
      borderRadius: { card: "12px", input: "10px", modal: "16px" },
      boxShadow: {
        "dark-card":   "0 1px 2px rgb(0 0 0 / 0.35)",
        "dark-raised": "0 1px 2px rgb(0 0 0 / 0.4), 0 6px 20px -10px rgb(0 0 0 / 0.6)",
        "dark-pop":    "0 20px 48px -16px rgb(0 0 0 / 0.7), 0 2px 8px -4px rgb(0 0 0 / 0.5)",
        "dark-glow":   "0 0 0 1px rgb(66 133 255 / 0.22), 0 10px 34px -12px rgb(66 133 255 / 0.5)",
      },
      transitionTimingFunction: { out: "cubic-bezier(0.22, 1, 0.36, 1)" },
      transitionDuration: { fast: "150ms", base: "200ms", slow: "250ms" },
    },
  },
};
```

**Preferred (v4, matching this repo):** keep the CSS-variable approach and bridge it —
no config file at all.

```css
@import "tailwindcss";
/* :root { … } .theme-dark { … } as in §19 */
@theme inline {
  --color-canvas: var(--canvas);
  --color-surface: var(--surface);
  --color-surface-muted: var(--surface-muted);
  --color-line: var(--line);
  --color-line-strong: var(--line-strong);
  --color-ink: var(--ink);
  --color-ink-muted: var(--ink-muted);
  --color-ink-subtle: var(--ink-subtle);
  --color-brand: var(--brand);
  --color-brand-soft: var(--brand-soft);
  --color-brand-ink: var(--brand-ink);
  --color-positive: var(--positive);
  --color-warning: var(--warning);
  --color-critical: var(--critical);
  --color-info: var(--info);
}
```

---

## 19. Copyable CSS dark theme

Drop-in block reproducing the exact HR Copilot dark theme.

```css
.theme-dark {
  /* Surfaces — deep navy, never black. */
  --page: #060e1c;
  --canvas: #060e1c;
  --surface: #0b162a;
  --surface-raised: #101f3a;
  --surface-muted: #101f3a;
  --elevated: #081326;

  /* Borders */
  --border: #1c3054;
  --line: #1c3054;
  --line-strong: #294470;

  /* Text */
  --text: #f0f6ff;
  --ink: #f0f6ff;
  --text-muted: #a2b3cd;
  --ink-muted: #a2b3cd;
  --ink-subtle: #6e82a0;
  --ink-inverted: #060e1c;

  /* Accent */
  --primary: #4285ff;
  --primary-hover: #609aff;
  --brand: #4285ff;
  --brand-hover: #609aff;
  --accent-soft: #11264e;
  --brand-soft: #11264e;
  --brand-ink: #96beff;

  /* Semantic */
  --success: #34d399;
  --positive: #34d399;
  --positive-soft: #0a2926;
  --warning: #fbbf5a;
  --warning-soft: #2a2113;
  --danger: #fb7185;
  --critical: #fb7185;
  --critical-soft: #2c1622;
  --info: #7aa7f8;
  --info-soft: #0f1f3a;
  --neutral-soft: #101e36;

  /* Ambience */
  --grid-color: rgb(66 133 255 / 0.07);
  --grid-size: 32px;
  --ai-glow: rgb(66 133 255 / 0.20);
  --ai-glow-warm: rgb(124 108 246 / 0.16);

  /* AI stays violet while the product is blue. */
  --ai-tint: #101c33;
  --ai-line: #2b3a63;
  --ai-ink: #a99dff;

  /* Elevation */
  --ring: #4285ff;
  --shadow-card: 0 1px 2px rgb(0 0 0 / 0.35);
  --shadow-raised: 0 1px 2px rgb(0 0 0 / 0.4), 0 6px 20px -10px rgb(0 0 0 / 0.6);
  --shadow-pop: 0 20px 48px -16px rgb(0 0 0 / 0.7), 0 2px 8px -4px rgb(0 0 0 / 0.5);
  --shadow-glow: 0 0 0 1px rgb(66 133 255 / 0.22), 0 10px 34px -12px rgb(66 133 255 / 0.5);

  /* Motion */
  --motion-fast: 150ms;
  --motion-base: 200ms;
  --motion-slow: 250ms;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);

  color-scheme: dark;
}
```

Pair it with the grid + glow from §14 and the `:focus-visible` / `::selection` rules from
§15 to reproduce the look faithfully.

---

## 20. Reference components

| Pattern | File |
|---|---|
| Page background, grid, glow, focus, skeleton | `app/globals.css` |
| Theme state, boot script, persistence | `lib/theme/theme.ts` |
| Boot injection, PWA theme-color | `app/layout.tsx` |
| Desktop navbar + theme toggle | `components/layout/Header.tsx` |
| Desktop nav items | `components/layout/TopNav.tsx` |
| Mobile bottom nav | `components/layout/BottomNav.tsx` |
| Card | `components/ui/Card.tsx` |
| Button (all variants/states) | `components/ui/Button.tsx` |
| Input / select / checkbox / errors | `components/ui/Field.tsx` |
| Badge + Chip | `components/ui/Badge.tsx` |
| Table | `components/ui/DataTable.tsx` |
| Score ring + band chips | `components/candidate/ui/MatchScore.tsx` |
| Match card (composite) | `components/candidate/MatchCard.tsx` |
| Requirement matrix (responsive grid-as-table) | `components/match/RequirementMatrix.tsx` |
| Status → tone/glyph mapping (pure) | `lib/match/presentation.ts` |
| Transferable / contradiction / trajectory panels | `components/match/MatchInsightSections.tsx` |
| Modal / drawer + scrim | `components/plan/DemoCheckoutModal.tsx`, `components/workspace/EvidenceDrawer.tsx` |
| AI-tinted panel | `components/ai/AiInsightPanel.tsx` |

---

## 21. Best reference pages

| Page | Route | Why |
|---|---|---|
| **Candidate detail** | `/candidates/[id]` | The densest screen: tabs, cards, match summary, matrix, evidence, table, drawer |
| **AI Job Match** | `/job-matches` | `ambient-hero`, score rings, band chips, dimension bars, matrix |
| **External jobs** | `/external-jobs` | Filter chips, pagination, drawer, AI tool tabs |
| **Plans** | `/plans` | Plan cards, badges, primary CTAs, modal |
| **Candidate home** | `/home` | Hero, stat cards, AI capability cards, readiness list |
| **Compare** | `/compare` | Superlative cards, comparison rows, dense table |
| **Login** | `/login` | Minimal surface — the grid and glow are most visible here |
| **Offline** | `/offline` | Smallest complete page; useful for isolating the base treatment |

---

## 22. Notes for reproducing this theme in a new project

1. **Deep navy, never black.** `#060e1c` page / `#0b162a` surface. The source is explicit:
   on true black the indigo accent "reads as a screen defect rather than as light".

2. **Separate depth by temperature and a 1px border, not by shadow.** Shadows exist but
   do almost no work in flat UI; the border does.

3. **Ship the grid and the glow.** `body::before` (32px blue hairlines at 7%, masked to
   fade) and `body::after` (blue + violet radials off the top-left). This is the single
   most recognisable part of the aesthetic, and it costs two pseudo-elements.

4. **Keep a second hue for AI.** Product blue `#4285ff`, generated-content violet
   `#a99dff`. Collapsing them loses the distinction on purpose-built AI surfaces.

5. **One accent with one hover step.** No third blue. Depth on the primary CTA comes from
   a short gradient ramp plus a coloured bloom (`.btn-raised`), dark mode only.

6. **Absence is neutral, not red.** Reserve `critical` for genuine conflicts. "No evidence
   found" is grey. This single rule shapes how the whole status palette reads.

7. **Two focus treatments.** Buttons get a 2px solid ring offset in the *surface* colour
   so it never merges with the border; inputs get a soft 3px `brand/15` ring.

8. **Resolve the theme before first paint.** A class written by a synchronous `<head>`
   script, plus one token block per theme. Do not add a `prefers-color-scheme` copy — it
   duplicates ~40 values that will drift.

9. **Tint the scrim with `--ink`, not black.** `bg-ink/45` inverts with the theme; a fixed
   black scrim does not.

10. **Explicit small type sizes.** `text-[13px]`, `text-[12.5px]`, `text-[11.5px]` rather
    than Tailwind's scale — this is what makes it read as dense professional software.

11. **Respect reduced motion.** A global block clamps every animation to `0.01ms`, and the
    spotlight disables itself entirely.

12. **Do not communicate state by colour alone.** Every status carries a glyph and a word
    as well as a tint (`lib/match/presentation.ts`).

---

*Extraction only. No code was modified, committed or deployed.*
