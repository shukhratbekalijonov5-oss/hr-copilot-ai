import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { I18nProvider } from "@/lib/i18n/context";
import { getI18n, getTranslations } from "@/lib/i18n/server";
import { LOCALE_META } from "@/lib/i18n/locales";
import { THEME_BOOT_SCRIPT } from "@/lib/theme/theme";
import { PWA } from "@/lib/pwa/config";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
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
    applicationName: PWA.name,

    /*
     * iOS home-screen behaviour.
     *
     * `capable` is what makes a launch from the home screen open WITHOUT
     * Safari's chrome. `title` is the label under the icon — the app name in
     * full would be truncated, so the short one is used deliberately.
     *
     * `statusBarStyle: "default"` rather than `black-translucent`: the
     * translucent style draws the page UNDER the status bar, which on a
     * notched phone puts the clock on top of our header unless every screen
     * pays for it. The default style leaves the bar opaque and the layout
     * honest.
     */
    appleWebApp: {
      capable: true,
      title: PWA.shortName,
      statusBarStyle: "default",
    },

    icons: {
      icon: [
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      // iOS ignores the manifest for this and reads the tag; it must be a
      // PNG, and an SVG here silently falls back to a page screenshot.
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },

    // Silences the legacy `format-detection` guesswork that turns any digit
    // sequence in a candidate's resume into a phone link on iOS.
    formatDetection: { telephone: false },
  };
}

/**
 * Viewport and browser chrome.
 *
 * `viewportFit: "cover"` lets the page reach into the safe areas so a fixed
 * bottom bar sits flush with the bottom of the screen; the bar itself pays
 * for the inset with `env(safe-area-inset-bottom)`, which is the only correct
 * place to pay it.
 *
 * `maximumScale` is deliberately NOT set. Blocking pinch-zoom is an
 * accessibility failure — it is the one gesture a low-vision reader relies on
 * — and it buys nothing that a correct responsive layout does not already
 * give.
 *
 * The two `themeColor` entries are the SURFACE colour per scheme, so the
 * browser's own bar matches the header it sits above rather than seaming
 * against it.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: PWA.themeColor },
    { media: "(prefers-color-scheme: dark)", color: PWA.themeColorDark },
  ],
};

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
      expected difference is declared here. It is now the ONLY such
      difference: the sidebar's width class went with the sidebar.

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
          {/* Registers the worker after hydration; renders nothing. */}
          <ServiceWorkerRegistrar />
        </I18nProvider>
      </body>
    </html>
  );
}
