# HR Copilot AI — transactional email templates

Design and localized content for the **three** transactional emails the product
sends. This directory is a **design deliverable**, not running code: nothing here
is imported by the Next.js app, nothing sends mail, and no provider, key, or
service was touched.

The notification service already owns delivery. What it does not yet have is a
designed, CTA-bearing, brand-consistent template — its own
`EmailTemplates.java` says *"the full brand redesign is the next phase"*. This is
that phase, delivered as static template files it can adopt.

---

## 1. What is here

```
docs/email-templates/
├── README.md              ← this spec
├── src/
│   ├── strings.json       ← the copy deck: 3 templates × 4 locales
│   ├── build.mjs          ← renders dist/ (the deliverable)
│   ├── preview.mjs        ← fills sample values, builds the proof sheet
│   ├── measure.mjs        ← asserts no horizontal overflow at 320/390px
│   └── shots.mjs          ← captures the 24 proof screenshots
├── dist/                  ← 12 HTML parts + 12 text parts, placeholders INTACT
│   ├── subjects.json      ← every subject line, machine-readable
│   └── backend-keys/      ← same 24 files, keyed the way the service ALREADY
│                            populates them (see §3) — adopt these to rename
│                            nothing
└── preview/
    ├── index.html         ← open this in a browser
    ├── filled/            ← same templates with sample values substituted
    └── screenshots/       ← 24 PNGs: 3 templates × 4 locales × desktop/mobile
```

Rebuild everything:

```bash
node src/build.mjs      # dist/
node src/preview.mjs    # preview/filled/ + preview/index.html
node --experimental-websocket src/measure.mjs   # overflow check (node >= 22: no flag)
node --experimental-websocket src/shots.mjs     # screenshots
```

`dist/` is the handoff artifact. `preview/` is proof and can be regenerated or
deleted freely.

---

## 2. The three emails

| # | Template id | Event (existing `ChannelPolicy`) | CTA | CTA target |
|---|---|---|---|---|
| 1 | `account_created` | `ACCOUNT_CREATED` | Open HR Copilot AI | `{appUrl}` |
| 2 | `subscription_activated` | `SUBSCRIPTION_ACTIVATED` | Manage subscription | `{billingUrl}` |
| 3 | `subscription_expiring` | `SUBSCRIPTION_EXPIRES_IN_3_DAYS` | View subscription | `{billingUrl}` |

Template ids map 1:1 onto the event types that already exist. **No new email
event type is introduced.**

### Subject lines

| Template | Locale | Subject |
|---|---|---|
| `account_created` | en | Welcome to HR Copilot AI |
| | ko | HR Copilot AI에 오신 것을 환영합니다 |
| | ru | Добро пожаловать в HR Copilot AI |
| | uz | HR Copilot AI ga xush kelibsiz |
| `subscription_activated` | en | Subscription activated — HR Copilot AI |
| | ko | 구독이 활성화되었습니다 — HR Copilot AI |
| | ru | Подписка активирована — HR Copilot AI |
| | uz | Obuna faollashtirildi — HR Copilot AI |
| `subscription_expiring` | en | Your HR Copilot AI subscription expires in 3 days |
| | ko | HR Copilot AI 구독이 3일 후 만료됩니다 |
| | ru | Ваша подписка HR Copilot AI истекает через 3 дня |
| | uz | HR Copilot AI obunangiz 3 kundan keyin tugaydi |

Also in `dist/subjects.json`.

Each template additionally carries a **preheader** — the hidden line inbox lists
show after the subject. It is in `strings.json` and already rendered into the
HTML; it is not a placeholder and needs no backend input.

---

## 3. Placeholder contract

Placeholders use the same `{curly}` syntax the notification service already
substitutes, so `EmailTemplates.substitute()` works unchanged.

| Placeholder | Used by | Required | Backend source (as built) |
|---|---|---|---|
| `{fullName}` | all three | **yes** | `recipient.fullName()` → key `name` |
| `{appUrl}` | account_created | **yes** | `ctaUrlFor()` → key `url` |
| `{billingUrl}` | activated, expiring | **yes** | `ctaUrlFor()` → key `url` (same key) |
| `{assetBaseUrl}` | all three (logo `src`) | **yes** | **no source** — needs a config constant |
| `{planName}` | activated, expiring | optional row | context `plan` → key `detail.plan` |
| `{subStatus}` | activated | optional row | context `status` → key `detail.status` |
| `{startDate}` | activated | optional row | context `periodStart` → key `detail.start` |
| `{expiresAt}` | activated, expiring | optional row | context `periodEnd` → key `detail.end` |
| `{amount}` | activated | optional row | `formatAmount()` → key `detail.amount` |
| `{currency}` | activated | optional row | **no source** — folded into `detail.amount` |

### The names above are this task's; the service uses different ones

The task specified these placeholder names. While this design was being
produced, the notification service converged on its own set. Both are listed
above, and **`dist/backend-keys/` ships the identical design already keyed the
service's way**, so nothing has to be renamed on either side. Pick one
directory and use it.

| This spec | Service (as built) | Note |
|---|---|---|
| `{fullName}` | `{name}` | |
| `{planName}` | `{detail.plan}` | legacy `{plan}` also populated |
| `{expiresAt}` | `{detail.end}` | legacy `{date}` also populated |
| `{startDate}` | `{detail.start}` | |
| `{subStatus}` | `{detail.status}` | |
| `{amount}` | `{detail.amount}` | already includes the currency |
| `{currency}` | *(none)* | row removed in `backend-keys/` |
| `{appUrl}`, `{billingUrl}` | `{url}` | both collapse — `ctaUrlFor()` already picks the destination per email type |
| `{assetBaseUrl}` | *(none)* | still unresolved |

Two of those merges are worth stating plainly:

- **One URL, not two.** `ctaUrlFor()` returns the app root for
  `ACCOUNT_CREATED` and `<base>/plans` for both subscription mails, so a single
  `{url}` is sufficient and the two-placeholder split adds nothing.
- **Amount already carries its currency.** `formatAmount(amountMinor, currency)`
  returns one display string, so the separate Currency row this task asked for
  has no value to render. It is present in `dist/` as specified and **removed**
  in `dist/backend-keys/` rather than left to draw an empty row.

### Values these templates never transform

`{planName}`, `{subStatus}`, `{startDate}`, `{expiresAt}`, `{amount}` and
`{currency}` are printed **exactly as supplied**. The template does not
translate, localize, format, or round any of them.

Consequences worth deciding on the backend side:

- **`{subStatus}` is not translated.** If the map supplies `ACTIVE`, a Korean
  reader sees `ACTIVE`. Supply a display-ready, already-localized string.
- **Dates are not formatted.** The worker currently formats `periodEnd` as
  `yyyy-MM-dd` in UTC. That is legible but not localized, and UTC can name the
  wrong day for a Korean subscriber near midnight. The preview deliberately
  shows a different date format per locale to make the seam visible.
- **`{amount}` and `{currency}` are separate rows** because the task specified
  them that way. If billing would rather render `₩16,900` as one string, drop
  the `currency` row (see §4) and pass the formatted value as `{amount}`.

### Security note

`{appUrl}`, `{billingUrl}` and `{assetBaseUrl}` are interpolated into `href` and
`src` attributes. They must come from **server configuration only** — never from
user-controlled data — because a `javascript:` or `data:` value would survive
HTML-escaping intact. The existing `htmlEscape()` correctly protects the text
placeholders; it is not a URL sanitizer.

---

## 4. Conditional rows

> *"Do not render rows whose values are absent."*

Every detail row is wrapped in strip markers so a row can be removed without
parsing HTML.

HTML part:

```html
<!-- row:amount:start -->
<tr> … {amount} … </tr>
<!-- row:amount:end -->
```

Text part:

```
[row:amount]Amount: {amount}[/row:amount]
```

Row keys: `plan`, `status`, `startDate`, `expiresAt`, `amount`, `currency`.

**Order of operations matters: strip absent rows first, substitute second.**
Substituting first leaves an empty `{amount}` cell that still draws a label and
a border rule.

Removing every row of a details block leaves an orphan section heading. Either
drop the block when no rows survive, or rely on the fact that `plan` is always
present today.

The design is valid with any subset: the first surviving row draws no top
border, and the rules between rows collapse naturally because each row carries
its own `border-top`.

---

## 5. Design language

Colours are lifted verbatim from `app/globals.css` `:root` (the light theme).
Emails are always light-bodied, so the light tokens *are* the email palette.
**Exactly eight colours are used across all twelve files. None is invented.**

| Token | Value | Role in the email |
|---|---|---|
| `--page` | `#f1f6fd` | Page background behind the card |
| `--surface` | `#ffffff` | The card |
| `--border` | `#dbe6f4` | 1px card border |
| `--brand-soft` | `#e7effe` | Hairline between detail rows |
| `--ink` | `#0f1726` | Headings, body, detail values |
| `--ink-muted` | `#5b6a82` | Secondary body, labels, footer, eyebrow |
| `--brand` | `#2d5be8` | CTA button fill |
| `--brand-ink` | `#1d40af` | Fallback link text |

`--ink-subtle` (`#8393ac`) is deliberately **excluded**: at 12px on white it
measures 3.12:1, below the 4.5:1 AA floor. The section eyebrow uses
`--ink-muted` (5.48:1) instead.

Structure is one white card on a tinted page, a 1px border and no shadow —
which is how the product's own `Card` separates surfaces. Restraint is the
brief: one accent colour, one button, no gradients, no marketing imagery.

### Logo

The header pairs the **existing** PWA icon (`public/icons/icon-192.png`, a spark
mark on `#2D5BE8`) with the wordmark as **live text**. No new logo was created.

The image carries `alt=""` on purpose: it is decorative, and the wordmark beside
it already says "HR Copilot AI". With images blocked — Outlook's default — the
header still reads correctly and no placeholder box interrupts it.

---

## 6. Email client compatibility

Targets: Gmail web, Gmail mobile, Outlook (Windows/Word), Apple Mail, Naver Mail.

- **Tables for layout**, `role="presentation"` so screen readers skip the
  scaffolding. No flexbox, no grid, no positioning.
- **Inline styles on every element.** The one `<style>` block holds a single
  media query and is a pure enhancement — the layout is already correct with it
  fully discarded, which is what happens in forwarded Gmail messages.
- **No `font:` shorthand**, no CSS variables, no `rem`. Word's renderer drops
  shorthand and has no variable support.
- **No web fonts.** Stack ends at `Arial, sans-serif`, with
  `Apple SD Gothic Neo` / `Malgun Gothic` / `Noto Sans KR` ahead of it so Korean
  does not fall back to a system serif.
- **Fluid width**: `width:100%` capped by `max-width:600px`. Content column is
  600px on desktop and edge-to-edge minus a 16px gutter on a phone.
- **Bulletproof CTA**: background colour on the `<td>` (with a `bgcolor`
  attribute for Word), padding on the `<a>`. Outlook drops the `border-radius`
  and shows a square button — intended degradation, not breakage.
- **`<meta name="color-scheme" content="light">`** plus a background *and* a
  colour on every surface. Clients that force-invert then have both halves of
  each pair to invert together, instead of leaving dark text on an inverted dark
  background.
- **Size**: largest file is ~11 KB, far under Gmail's ~102 KB clipping
  threshold.
- **Plain-text part** ships with every email — the accessible fallback, and it
  keeps the message clear of spam heuristics that penalise HTML-only mail.

### Measured, not assumed

`src/measure.mjs` drives headless Chrome and compares `scrollWidth` against the
viewport at **320px** and **390px** for all 12 files:

```
NO HORIZONTAL OVERFLOW — 24 renders clean
```

The check is self-verified: injecting a deliberate 900px element makes it fail
(`OVERFLOW 320px +580px <DIV>`), so a pass means something.

---

## 7. Accessibility

Every text/background pair, measured (WCAG 2.1 relative luminance):

| Element | Colours | Size | Ratio | AA |
|---|---|---|---|---|
| Heading | `#0f1726` on `#ffffff` | 23px bold | 17.94 | pass |
| Body | `#0f1726` on `#ffffff` | 15px | 17.94 | pass |
| Secondary body | `#5b6a82` on `#ffffff` | 15px | 5.48 | pass |
| Detail label | `#5b6a82` on `#ffffff` | 14px | 5.48 | pass |
| Detail value | `#0f1726` on `#ffffff` | 14px | 17.94 | pass |
| Section eyebrow | `#5b6a82` on `#ffffff` | 12px | 5.48 | pass |
| CTA label | `#ffffff` on `#2d5be8` | 15px bold | 5.57 | pass |
| Fallback link | `#1d40af` on `#ffffff` | 13px | 8.73 | pass |
| Footer | `#5b6a82` on `#f1f6fd` | 13px | 5.05 | pass |

All nine pairs clear AA for normal-size text. The eyebrow originally used
`--ink-subtle` and measured 3.12:1; it was recoloured rather than shipped.

Other properties:

- **Smallest type is 12px**, and only on the section eyebrow. Body is 15px,
  footer 13px. There is no fine print.
- **The CTA never depends on colour**: it is a labelled button whose text states
  the action ("Manage subscription"), followed by the same URL in plain text for
  anyone who cannot activate it.
- **Semantic hierarchy**: one `<h1>` per email, real `<p>` paragraphs, a real
  `<table>` for the detail pairs. Layout tables are `role="presentation"`.
- **`lang` is set per locale** on `<html>`, so screen readers select the right
  voice — a Korean body announced with an English voice is unintelligible.
- **Decorative logo is `alt=""`**, so it is skipped rather than announced.
- **Readable with images off**, which is also the Outlook default.

---

## 8. Tone

The expiry reminder is informative, not urgent. No countdown, no red, no
"act now", no consequence framing. It states the date, states that renewing
before it keeps access uninterrupted, and offers a neutral "View subscription".

The same restraint applies to the activation email: it confirms and reports
facts, and does not upsell.

---

## 9. What Backend AI needs to supply

Nothing in this directory is wired to anything. To adopt it:

1. **Use `dist/backend-keys/`** — those files already match the keys
   `EmailDeliveryWorker.templateValues()` populates. No renaming on either side.
2. **Supply `{assetBaseUrl}`** — the one remaining unbound placeholder. It
   should be the public origin (`https://hrcopilot.cloud`) so the logo resolves.
   Left empty the emails still render correctly and accessibly, minus the mark,
   because the wordmark beside it is live text.
3. **Implement row stripping** before substitution (§4). This is the only
   behavioural change the design requires. Every `detail.*` value is already
   conditional by construction on the producing event, so the values map is
   correct as-is — what is missing is removing the row when the key is absent.
4. **Consider localizing `{detail.status}` and the date format** (§3). Dates are
   currently `yyyy-MM-dd` in UTC, which can name the wrong day for a Korean
   subscriber near midnight, and a raw status like `ACTIVE` reaches a Korean
   reader untranslated. Neither is a blocker; both are visible in the preview
   sheet on purpose.

Because every added row is optional, adoption can be incremental: take the
shell plus `{name}`/`{detail.plan}` first, and rows appear as billing exposes
them.

## 10. Scope

Changed: only files inside `frontend/docs/email-templates/`.

Not touched: the notification service, the payment service, the backend, Kafka,
the database, Kubernetes, Resend, any API key, and any Next.js route, page,
component or bundle.

`EmailTemplates.java` and `EmailDeliveryWorker.java` were **read** — twice, since
Backend AI was editing them concurrently — so that this contract describes the
service as actually built rather than as it stood at the start. They were not
modified.
