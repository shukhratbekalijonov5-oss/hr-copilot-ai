import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { HelpIcon } from "@/components/ui/icons";

interface NotFoundStateProps {
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
}

export function NotFoundState({
  title,
  description,
  backHref,
  backLabel,
}: NotFoundStateProps) {
  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-xl border border-line bg-surface shadow-card">
        <EmptyState
          icon={<HelpIcon className="size-5" />}
          title={title}
          description={description}
          action={
            <Link href={backHref} className={buttonStyles("secondary", "sm")}>
              {backLabel}
            </Link>
          }
        />
      </div>
    </div>
  );
}
