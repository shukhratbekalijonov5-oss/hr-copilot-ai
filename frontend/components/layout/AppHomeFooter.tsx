"use client";

import { MailIcon, PhoneIcon, SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import {
  CONTACT,
  CONTACT_EMAIL_HREF,
  configuredSocialLinks,
} from "@/lib/config/contact";

/**
 * The footer, on the two home pages and nowhere else.
 *
 * ## Why only Home
 *
 * Every other authenticated screen is somewhere a reader is *working* — a
 * candidate list they are scanning, a chat they are in the middle of, search
 * results they are about to refine. A block of company boilerplate under a
 * work surface is something to scroll past, and repeating it thirty times
 * makes it invisible anyway. Home is the one screen a session starts and
 * returns to, which makes it the one place this is read rather than skipped.
 *
 * ## Restrained on purpose
 *
 * Three compact columns, one border, one bottom row. This is an application,
 * not a marketing site: there is no newsletter box, no sitemap of links the
 * navigation already carries, and no second copy of the product pitch. The
 * things here are the ones that have nowhere else to live — who we are, how
 * to reach a human, and the copyright line.
 *
 * ## It never invents a destination
 *
 * Social links render only when `lib/config/contact.ts` actually holds a URL,
 * and the whole block disappears when none do. Privacy and Terms are absent
 * because no such routes exist — a footer link to a 404 is worse than no link.
 */
export function AppHomeFooter() {
  const { d } = useI18n();
  const socials = configuredSocialLinks();

  return (
    <footer
      /*
        `mt-10` separates it from the page's last panel, and the bottom padding
        is the mobile bar's problem: `AppShell` already pays `pb-24` for the
        fixed bottom navigation, so this needs nothing extra to clear it —
        adding more here would open a gap on desktop, where no bar exists.
      */
      className="footer-panel mt-10 rounded-[16px] border border-line bg-elevated px-5 py-6 sm:px-7 sm:py-7"
    >
      <div className="grid gap-7 md:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-8">
        {/* Product. */}
        <div className="min-w-0">
          <p className="flex items-center gap-2.5">
            <span className="btn-raised ai-halo flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-brand text-white">
              <SparkIcon className="size-4" aria-hidden="true" />
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
              {d.meta.appName}
            </span>
          </p>
          <p className="mt-3 max-w-[46ch] text-[12.5px] leading-relaxed text-ink-muted">
            {d.footer.tagline}
          </p>
          <p className="mt-1.5 max-w-[46ch] text-[12.5px] leading-relaxed text-ink-subtle">
            {d.footer.blurb}
          </p>
        </div>

        {/* Contact. Both rows are real, working protocol links. */}
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-subtle">
            {d.footer.contact}
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            <li>
              <a
                href={CONTACT.phoneHref}
                aria-label={`${d.footer.phoneLabel}: ${CONTACT.phone}`}
                className="group inline-flex min-w-0 items-center gap-2 rounded-[8px] text-[13px] text-ink-muted transition-colors duration-[var(--motion-fast)] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-elevated"
              >
                <PhoneIcon className="size-4 shrink-0 text-ink-subtle transition-colors duration-[var(--motion-fast)] group-hover:text-brand" />
                <span className="truncate">{CONTACT.phone}</span>
              </a>
            </li>
            <li>
              <a
                href={CONTACT_EMAIL_HREF}
                aria-label={`${d.footer.emailLabel}: ${CONTACT.email}`}
                className="group inline-flex min-w-0 items-center gap-2 rounded-[8px] text-[13px] text-ink-muted transition-colors duration-[var(--motion-fast)] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-elevated"
              >
                <MailIcon className="size-4 shrink-0 text-ink-subtle transition-colors duration-[var(--motion-fast)] group-hover:text-brand" />
                <span className="truncate">{CONTACT.email}</span>
              </a>
            </li>
          </ul>
        </div>

        {/*
          Social. Absent entirely until a URL is configured — an empty column
          of dead grey glyphs asks the reader to work out why they cannot be
          clicked, which is a worse answer than not raising the question.
        */}
        {socials.length > 0 ? (
          <div className="min-w-0">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-subtle">
              {d.footer.social}
            </h2>
            <ul className="mt-3 flex flex-wrap items-center gap-2">
              {socials.map((social) => {
                const Icon = social.icon;
                return (
                  <li key={social.id}>
                    <a
                      href={social.url}
                      target="_blank"
                      /*
                        `noopener` denies the opened tab a handle on this one;
                        `noreferrer` keeps the reader's current URL out of the
                        other site's referrer log. Both, on every external link.
                      */
                      rel="noopener noreferrer"
                      aria-label={social.label}
                      className="flex size-9 items-center justify-center rounded-[10px] border border-line bg-surface text-ink-muted transition-colors duration-[var(--motion-fast)] hover:border-line-strong hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-elevated"
                    >
                      <Icon className="size-4.5" aria-hidden="true" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="mt-6 border-t border-line pt-4">
        <p className="text-[11.5px] text-ink-subtle">{d.footer.rights}</p>
      </div>
    </footer>
  );
}
