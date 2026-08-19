import Link from "next/link";
import { CheckIcon, SparkIcon } from "@/components/ui/icons";
import { getTranslations } from "@/lib/i18n/server";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const d = await getTranslations();

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,30rem)]">
      <section className="hidden flex-col justify-between border-r border-line bg-surface p-10 lg:flex">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-brand text-white">
            <SparkIcon className="size-4" />
          </span>
          {d.meta.appName}
        </Link>

        <div className="max-w-md">
          <h2 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
            {d.auth.heroTitle}
          </h2>
          <ul className="mt-6 flex flex-col gap-3">
            {d.auth.heroPoints.map((point) => (
              <li key={point} className="flex gap-2.5 text-[13.5px] text-ink-muted">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-positive" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[12px] text-ink-subtle">
          © {new Date().getFullYear()} {d.meta.appName}
        </p>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <Link
            href="/dashboard"
            className="mb-8 flex items-center gap-2 text-sm font-semibold tracking-tight text-ink lg:hidden"
          >
            <span className="flex size-7 items-center justify-center rounded-lg bg-brand text-white">
              <SparkIcon className="size-4" />
            </span>
            {d.meta.appName}
          </Link>
          {children}
        </div>
      </section>
    </div>
  );
}
