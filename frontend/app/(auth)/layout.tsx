import Link from "next/link";
import { APP_NAME } from "@/lib/constants";
import { CheckIcon, SparkIcon } from "@/components/ui/icons";

const POINTS = [
  "Every extracted claim links back to the page it came from.",
  "Search resumes in plain language across your whole pipeline.",
  "Shortlisting and rejection stay human decisions, always.",
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
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
          {APP_NAME}
        </Link>

        <div className="max-w-md">
          <h2 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
            Read every resume properly, without reading every resume.
          </h2>
          <ul className="mt-6 flex flex-col gap-3">
            {POINTS.map((point) => (
              <li key={point} className="flex gap-2.5 text-[13.5px] text-ink-muted">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-positive" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[12px] text-ink-subtle">
          © {new Date().getFullYear()} {APP_NAME}
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
            {APP_NAME}
          </Link>
          {children}
        </div>
      </section>
    </div>
  );
}
