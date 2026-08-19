import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import { format } from "@/lib/i18n/format";
import { getTranslations } from "@/lib/i18n/server";

export default async function NotFound() {
  const d = await getTranslations();

  return (
    <main className="flex min-h-dvh items-center justify-center px-5">
      <div className="max-w-md text-center">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
          404
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">
          {d.errors.notFoundTitle}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
          {format(d.errors.notFoundHint, { app: d.meta.appName })}
        </p>
        <Link
          href="/dashboard"
          className={buttonStyles("secondary", "md", "mt-4")}
        >
          {d.errors.goToDashboard}
        </Link>
      </div>
    </main>
  );
}
