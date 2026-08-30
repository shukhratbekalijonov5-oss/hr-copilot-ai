/**
 * Fills `dist/` templates with SAMPLE values and builds the proof sheet.
 *
 * The sample values are fake but shaped like real ones. Dates and status
 * strings differ per locale on purpose: they are backend-formatted values
 * that the template only places, never translates or reformats. Seeing
 * them side by side is what proves that.
 *
 * Run: node preview.mjs   (after build.mjs)
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const LOCALES = ["en", "ko", "ru", "uz"];
const LOCALE_NAMES = { en: "English", ko: "한국어 (Korean)", ru: "Русский (Russian)", uz: "O'zbekcha (Uzbek)" };
const TEMPLATES = [
  ["account_created", "Account created"],
  ["subscription_activated", "Subscription activated"],
  ["subscription_expiring", "Subscription expires in 3 days"],
];

/**
 * Preview-only asset base. Production passes the absolute public origin
 * (https://hrcopilot.cloud); here it is a relative hop to `public/` so the
 * sheet renders with no network.
 */
const PREVIEW_ASSET_BASE = "../../../../public";

const SAMPLE = {
  common: {
    fullName: "Alex Kim",
    appUrl: "https://hrcopilot.cloud/dashboard",
    billingUrl: "https://hrcopilot.cloud/settings/billing",
    planName: "Pro",
    amount: "16,900",
    currency: "KRW",
  },
  en: { subStatus: "Active", startDate: "31 Aug 2026", expiresAt: "30 Sep 2026" },
  ko: { subStatus: "활성", startDate: "2026년 8월 31일", expiresAt: "2026년 9월 30일" },
  ru: { subStatus: "Активна", startDate: "31 августа 2026 г.", expiresAt: "30 сентября 2026 г." },
  uz: { subStatus: "Faol", startDate: "31-avgust 2026", expiresAt: "30-sentabr 2026" },
};

function fill(source, lang) {
  const values = { ...SAMPLE.common, ...SAMPLE[lang], assetBaseUrl: PREVIEW_ASSET_BASE };
  let out = source;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out;
}

mkdirSync(join(ROOT, "preview", "filled"), { recursive: true });

const remaining = new Set();
for (const [name] of TEMPLATES) {
  for (const lang of LOCALES) {
    const file = `${name}.${lang}.html`;
    const filled = fill(readFileSync(join(ROOT, "dist", file), "utf8"), lang);
    writeFileSync(join(ROOT, "preview", "filled", file), filled, "utf8");
    // Any {placeholder} still standing is one the sample set forgot.
    for (const match of filled.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)) remaining.add(match[1]);
  }
}

if (remaining.size > 0) {
  console.error("UNFILLED PLACEHOLDERS:", [...remaining].join(", "));
  process.exitCode = 1;
} else {
  console.log("all placeholders resolved in every locale");
}

/* --------------------------- the proof sheet --------------------------- */
const subjects = JSON.parse(readFileSync(join(ROOT, "dist", "subjects.json"), "utf8"));

const sections = TEMPLATES.map(([name, label]) => {
  const rows = LOCALES.map((lang) => `
      <div class="pair">
        <div class="meta">
          <span class="loc">${LOCALE_NAMES[lang]}</span>
          <span class="subj"><b>Subject:</b> ${subjects[name][lang]}</span>
        </div>
        <div class="frames">
          <figure>
            <figcaption>Desktop &mdash; 680&times;760</figcaption>
            <iframe src="filled/${name}.${lang}.html" width="680" height="760" loading="lazy" title="${label} ${lang} desktop"></iframe>
          </figure>
          <figure>
            <figcaption>Mobile &mdash; 375&times;760</figcaption>
            <iframe src="filled/${name}.${lang}.html" width="375" height="760" loading="lazy" title="${label} ${lang} mobile"></iframe>
          </figure>
        </div>
      </div>`).join("");
  return `<section><h2>${label}</h2>${rows}</section>`;
}).join("\n");

writeFileSync(
  join(ROOT, "preview", "index.html"),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HR Copilot AI — transactional email previews</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; padding:32px; background:#eef2f8; color:#0f1726;
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; }
  h1 { font-size:22px; margin:0 0 4px; letter-spacing:-0.02em; }
  .lede { margin:0 0 28px; color:#5b6a82; font-size:14px; max-width:70ch; line-height:1.6; }
  section { margin:0 0 40px; }
  h2 { font-size:16px; margin:0 0 12px; padding-bottom:8px; border-bottom:1px solid #dbe6f4; }
  .pair { margin:0 0 24px; }
  .meta { display:flex; gap:16px; flex-wrap:wrap; align-items:baseline; margin:0 0 8px; }
  .loc { font-weight:600; font-size:14px; }
  .subj { font-size:13px; color:#5b6a82; }
  .frames { display:flex; gap:16px; flex-wrap:wrap; }
  figure { margin:0; }
  figcaption { font-size:11px; text-transform:uppercase; letter-spacing:0.05em;
               color:#8393ac; margin:0 0 4px; }
  iframe { border:1px solid #dbe6f4; border-radius:8px; background:#fff; display:block; }
</style>
</head>
<body>
<h1>HR Copilot AI &mdash; transactional email previews</h1>
<p class="lede">Design proof only. Values shown are sample data; every one of them is a
{placeholder} in <code>dist/</code>. Both frames load the identical file &mdash; the only
difference is the viewport width, which is the point: one fluid template, no separate
mobile build.</p>
${sections}
</body>
</html>
`,
  "utf8",
);

console.log("preview sheet:", join(ROOT, "preview", "index.html"));
console.log("filled files:", readdirSync(join(ROOT, "preview", "filled")).length);
