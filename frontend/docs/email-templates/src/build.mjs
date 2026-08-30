/**
 * Renders the three HR Copilot AI transactional emails into `dist/`, one
 * HTML part and one text part per template per locale, and builds the
 * `preview/` proof sheet.
 *
 * ## What this script is and is not
 *
 * It is a DESIGN tool. It produces template files whose {placeholders} are
 * left intact, so the notification service substitutes them exactly as it
 * already does for its current strings. Nothing here sends mail, reads a
 * key, or talks to a provider.
 *
 * ## Why the markup looks like 2005
 *
 * Tables, inline styles, no `font:` shorthand, no flex/grid. Outlook on
 * Windows renders through Word, which has no CSS box model worth the name;
 * Gmail drops <head> styles in forwarded copies. The layout therefore has
 * to be correct with zero embedded CSS applied — the media query is an
 * enhancement, never a dependency.
 *
 * Run: node build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const STRINGS = JSON.parse(readFileSync(join(HERE, "strings.json"), "utf8"));

const LOCALES = ["en", "ko", "ru", "uz"];
const TEMPLATES = ["account_created", "subscription_activated", "subscription_expiring"];

/* ------------------------------------------------------------------ *
 * Palette — lifted verbatim from app/globals.css `:root` (light theme).
 * Emails are always light-bodied, so the light tokens ARE the email
 * palette. No value here is invented.
 * ------------------------------------------------------------------ */
const C = {
  page: "#f1f6fd",      // --page
  surface: "#ffffff",   // --surface
  border: "#dbe6f4",    // --border
  rule: "#e7effe",      // --brand-soft, the hairline inside the card
  ink: "#0f1726",       // --ink
  inkMuted: "#5b6a82",  // --ink-muted
  // --ink-subtle (#8393ac) is deliberately NOT used: at 12px on white it
  // measures 3.12:1, under the 4.5:1 AA floor for normal-size text. The
  // section eyebrow uses --ink-muted (5.48:1) instead.
  brand: "#2d5be8",     // --brand
  brandInk: "#1d40af",  // --brand-ink
};

/**
 * No web fonts: a client that blocks remote CSS must still get a sane
 * face, and Korean needs a real fallback before Arial or it lands on a
 * system serif.
 */
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue'," +
  "'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',Arial,sans-serif";

/** The published PWA icon. Decorative — the wordmark beside it is live text. */
const LOGO_URL = "{assetBaseUrl}/icons/icon-192.png";

const td = (extra) => `font-family:${FONT};${extra}`;

/**
 * A detail row, wrapped in strip markers.
 *
 * Backend renders a row only when it has a value; the markers give it a
 * mechanical way to remove one without parsing HTML. See README section 5.
 */
function detailRow(key, label, placeholder, isFirst) {
  const top = isFirst ? "" : `border-top:1px solid ${C.rule};`;
  // NO percentage widths. A td's `width:44%` is content-box, so cell padding
  // is added ON TOP of it — two padded percentage columns sum past 100% and
  // shove the value column outside the card at phone widths. Auto layout
  // with padding on one side only can never overflow: text wraps instead.
  return `<!-- row:${key}:start -->
                        <tr>
                          <td align="left" valign="top" style="${td(
                            `${top}padding:11px 16px 11px 0;font-size:14px;line-height:1.5;color:${C.inkMuted};`,
                          )}">${label}</td>
                          <td align="right" valign="top" style="${td(
                            `${top}padding:11px 0;font-size:14px;line-height:1.5;font-weight:600;color:${C.ink};word-break:break-word;`,
                          )}">{${placeholder}}</td>
                        </tr>
                        <!-- row:${key}:end -->`;
}

/** Bulletproof CTA: colour on the <td>, padding on the <a>. */
function button(label, urlPlaceholder) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" bgcolor="${C.brand}" style="background-color:${C.brand};border-radius:8px;">
                          <a href="{${urlPlaceholder}}" target="_blank" style="${td(
                            `display:inline-block;padding:14px 28px;font-size:15px;line-height:1.2;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;`,
                          )}">${label}</a>
                        </td>
                      </tr>
                    </table>`;
}

function paragraph(text, { muted = false, top = 16 } = {}) {
  return `<p style="${td(
    `margin:${top}px 0 0;font-size:15px;line-height:1.65;color:${muted ? C.inkMuted : C.ink};`,
  )}">${text}</p>`;
}

function heading(text) {
  return `            <h1 class="h1" style="${td(
    `margin:0;font-size:23px;line-height:1.3;font-weight:700;letter-spacing:-0.02em;color:${C.ink};`,
  )}">${text}</h1>`;
}

/** The link fallback, for clients that flatten the button. */
function linkFallback(shared, urlPlaceholder) {
  return `<p style="${td(
    `margin:18px 0 0;font-size:13px;line-height:1.6;color:${C.inkMuted};`,
  )}">${shared.linkFallback}<br><a href="{${urlPlaceholder}}" target="_blank" style="color:${C.brandInk};word-break:break-all;">{${urlPlaceholder}}</a></p>`;
}

function detailsBlock(title, rows) {
  return `            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;">
              <tr><td style="${td(
                `padding:0 0 4px;font-size:12px;line-height:1.4;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${C.inkMuted};`,
              )}">${title}</td></tr>
              <tr>
                <td>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${rows.join("\n")}
                  </table>
                </td>
              </tr>
            </table>`;
}

function ctaBlock(label, urlPlaceholder) {
  return `            <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="cta" style="margin:26px 0 0;">
              <tr><td>${button(label, urlPlaceholder)}</td></tr>
            </table>`;
}

/** The shared shell: preheader, header, white card, footer. */
function layout({ lang, subject, preheader, shared, cardHtml }) {
  return `<!doctype html>
<html lang="${lang}" dir="ltr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="x-ua-compatible" content="ie=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${subject}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style>
  /* Enhancement only. The layout is already correct without this block. */
  @media only screen and (max-width:620px) {
    .card { padding: 24px !important; }
    .gutter { padding-left: 16px !important; padding-right: 16px !important; }
    .h1 { font-size: 21px !important; }
    .cta a { display: block !important; text-align: center !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${C.page};color:${C.ink};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.page};">
  <tr>
    <td align="center" class="gutter" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

        <tr>
          <td align="left" style="padding:0 0 18px 2px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle" style="padding-right:10px;">
                  <img src="${LOGO_URL}" width="28" height="28" alt="${shared.logoAlt}" style="display:block;width:28px;height:28px;border:0;border-radius:6px;">
                </td>
                <td valign="middle" style="${td(
                  `font-size:16px;line-height:1.2;font-weight:600;letter-spacing:-0.01em;color:${C.ink};`,
                )}">${shared.wordmark}</td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td class="card" bgcolor="${C.surface}" style="background-color:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:32px;">
${cardHtml}
          </td>
        </tr>

        <tr>
          <td align="left" style="padding:20px 2px 0;">
            <p style="${td(
              `margin:0;font-size:13px;line-height:1.6;color:${C.inkMuted};`,
            )}">${shared.footerAutomated}</p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ *
 * The three templates.
 * ------------------------------------------------------------------ */
function accountCreated(t, shared) {
  return [
    heading(t.heading),
    `            ${paragraph(t.greeting, { top: 18 })}`,
    `            ${paragraph(t.body1)}`,
    `            ${paragraph(t.body2, { muted: true })}`,
    ctaBlock(t.cta, "appUrl"),
    `            ${linkFallback(shared, "appUrl")}`,
  ].join("\n");
}

function subscriptionActivated(t, shared) {
  const rows = [
    detailRow("plan", t.labelPlan, "planName", true),
    detailRow("status", t.labelStatus, "subStatus", false),
    detailRow("startDate", t.labelStartDate, "startDate", false),
    detailRow("expiresAt", t.labelExpiresAt, "expiresAt", false),
    detailRow("amount", t.labelAmount, "amount", false),
    detailRow("currency", t.labelCurrency, "currency", false),
  ];
  return [
    heading(t.heading),
    `            ${paragraph(t.greeting, { top: 18 })}`,
    `            ${paragraph(t.body1)}`,
    detailsBlock(t.detailsTitle, rows),
    ctaBlock(t.cta, "billingUrl"),
    `            ${linkFallback(shared, "billingUrl")}`,
  ].join("\n");
}

function subscriptionExpiring(t, shared) {
  const rows = [
    detailRow("plan", t.labelPlan, "planName", true),
    detailRow("expiresAt", t.labelExpiresAt, "expiresAt", false),
  ];
  return [
    heading(t.heading),
    `            ${paragraph(t.greeting, { top: 18 })}`,
    `            ${paragraph(t.body1)}`,
    `            ${paragraph(t.body2, { muted: true })}`,
    detailsBlock(t.detailsTitle, rows),
    ctaBlock(t.cta, "billingUrl"),
    `            ${linkFallback(shared, "billingUrl")}`,
  ].join("\n");
}

const BUILDERS = {
  account_created: accountCreated,
  subscription_activated: subscriptionActivated,
  subscription_expiring: subscriptionExpiring,
};

/* ------------------------------------------------------------------ *
 * Plain-text part. Every email ships one: it is the accessible fallback
 * and it keeps the message out of spam heuristics that punish HTML-only.
 * ------------------------------------------------------------------ */
function textPart(name, t, shared) {
  const lines = [shared.wordmark, "", t.heading, "", t.greeting, "", t.body1];
  if (t.body2) lines.push("", t.body2);

  const rows = {
    subscription_activated: [
      ["plan", t.labelPlan, "planName"],
      ["status", t.labelStatus, "subStatus"],
      ["startDate", t.labelStartDate, "startDate"],
      ["expiresAt", t.labelExpiresAt, "expiresAt"],
      ["amount", t.labelAmount, "amount"],
      ["currency", t.labelCurrency, "currency"],
    ],
    subscription_expiring: [
      ["plan", t.labelPlan, "planName"],
      ["expiresAt", t.labelExpiresAt, "expiresAt"],
    ],
  }[name];

  if (rows) {
    lines.push("", `${t.detailsTitle}`, "");
    for (const [key, label, placeholder] of rows) {
      lines.push(`[row:${key}]${label}: {${placeholder}}[/row:${key}]`);
    }
  }

  const url = name === "account_created" ? "{appUrl}" : "{billingUrl}";
  lines.push("", `${t.cta}: ${url}`, "", "--", shared.footerAutomated, "");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * A second emission using the notification service's ACTUAL key names.
 *
 * The canonical templates use the names this task specified. The service
 * converged on different ones while this was being designed, so rather
 * than make Backend AI rename anything, `dist/backend-keys/` ships the
 * identical design keyed the way EmailDeliveryWorker.templateValues()
 * already populates it. Both are generated from one source; neither is a
 * fork.
 *
 * Two mappings are not one-to-one and are handled here:
 *   - {appUrl} and {billingUrl} both collapse to {url}, because
 *     ctaUrlFor() already resolves the destination per email type.
 *   - {currency} has no source: formatAmount() returns amount AND
 *     currency as one string, so the currency row is REMOVED rather
 *     than left to render empty.
 * ------------------------------------------------------------------ */
const BACKEND_KEYS = {
  fullName: "name",
  appUrl: "url",
  billingUrl: "url",
  planName: "detail.plan",
  subStatus: "detail.status",
  startDate: "detail.start",
  expiresAt: "detail.end",
  amount: "detail.amount",
  // assetBaseUrl has no source yet; it stays as-is so the gap is visible
  // rather than silently resolving to an empty src.
};

/** Drops one row block from an HTML part and its text part. */
function dropRow(source, key) {
  const html = new RegExp(
    `[ \\t]*<!-- row:${key}:start -->[\\s\\S]*?<!-- row:${key}:end -->\\n?`, "g");
  const text = new RegExp(
    `\\[row:${key}\\][^\\n]*\\[\\/row:${key}\\]\\n?`, "g");
  return source.replace(html, "").replace(text, "");
}

function toBackendKeys(source) {
  let out = dropRow(source, "currency");
  for (const [from, to] of Object.entries(BACKEND_KEYS)) {
    out = out.split(`{${from}}`).join(`{${to}}`);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Emit.
 * ------------------------------------------------------------------ */
mkdirSync(join(ROOT, "dist", "backend-keys"), { recursive: true });
const manifest = [];

for (const name of TEMPLATES) {
  for (const lang of LOCALES) {
    const t = STRINGS[name][lang];
    const shared = STRINGS.shared[lang];
    const html = layout({
      lang,
      subject: t.subject,
      preheader: t.preheader,
      shared,
      cardHtml: BUILDERS[name](t, shared),
    });
    const text = textPart(name, t, shared);
    writeFileSync(join(ROOT, "dist", `${name}.${lang}.html`), html, "utf8");
    writeFileSync(join(ROOT, "dist", `${name}.${lang}.txt`), text, "utf8");
    writeFileSync(join(ROOT, "dist", "backend-keys", `${name}.${lang}.html`), toBackendKeys(html), "utf8");
    writeFileSync(join(ROOT, "dist", "backend-keys", `${name}.${lang}.txt`), toBackendKeys(text), "utf8");
    manifest.push({ name, lang, subject: t.subject, bytes: html.length });
  }
}

writeFileSync(
  join(ROOT, "dist", "subjects.json"),
  JSON.stringify(
    Object.fromEntries(
      TEMPLATES.map((n) => [n, Object.fromEntries(LOCALES.map((l) => [l, STRINGS[n][l].subject]))]),
    ),
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(`rendered ${manifest.length} HTML parts + ${manifest.length} text parts`);
for (const m of manifest) console.log(`  ${m.name}.${m.lang}  ${m.bytes}B  "${m.subject}"`);
