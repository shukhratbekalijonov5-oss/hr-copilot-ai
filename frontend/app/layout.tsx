import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { I18nProvider } from "@/lib/i18n/context";
import { getI18n, getTranslations } from "@/lib/i18n/server";
import { LOCALE_META } from "@/lib/i18n/locales";
import { THEME_BOOT_SCRIPT } from "@/lib/theme/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();

  return {
    title: {
      default: `${d.meta.appName} — ${d.meta.tagline}`,
      template: `%s · ${d.meta.appName}`,
    },
    description: d.meta.description,
  };
}

/**
 * The one place the active locale is resolved.
 *
 * `lang` on `<html>` is set from it — screen readers and the browser's own
 * translation prompt both depend on it being accurate — and the same dictionary
 * is handed to `I18nProvider` so client components read exactly what the server
 * rendered. Only this locale is serialised, never all four.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { locale, d } = await getI18n();

  return (
    /*
      `suppressHydrationWarning` belongs on THIS element and nowhere else.

      The boot script below writes `theme-light` or `theme-dark` onto
      `<html>` before React hydrates, so the client's className legitimately
      carries one token the server could not have known — the choice lives in
      `localStorage`, which SSR cannot read. React compares and warns.

      The alternatives are both worse: rendering a guessed theme class on the
      server would be wrong for half of readers and would flash, and applying
      the theme after mount would flash for everyone. So the server stays
      deterministic (fonts only, identical for every request) and the one
      expected difference is declared here.

      It suppresses only this element's own attributes — not its children, and
      not `<body>`. Any other mismatch anywhere in the tree still warns.
    */
    <html
      lang={LOCALE_META[locale].htmlLang}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Resolves the theme BEFORE the browser paints, so a reader who chose
          dark never sees a white flash on navigation. It is a static string
          from our own module — no user data reaches it — and it must be
          inline and synchronous, which is the one thing a `<Script>` with a
          loading strategy cannot be.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <I18nProvider locale={locale} dictionary={d}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
