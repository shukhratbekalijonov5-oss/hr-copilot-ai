import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import { APP_NAME } from "@/lib/constants";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5">
      <div className="max-w-md text-center">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
          404
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">
          Page not found
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
          The page you were looking for is not part of {APP_NAME}, or it has
          moved.
        </p>
        <Link
          href="/dashboard"
          className={buttonStyles("secondary", "md", "mt-4")}
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
