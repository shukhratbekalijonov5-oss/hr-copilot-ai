import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { I18nProvider } from "@/lib/i18n/context";
import { getI18n, getTranslations } from "@/lib/i18n/server";
import { LOCALE_META } from "@/lib/i18n/locales";
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
    <html
      lang={LOCALE_META[locale].htmlLang}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <I18nProvider locale={locale} dictionary={d}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
