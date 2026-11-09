import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** The top of a signed-in page: a small label, the page's h1, and its actions on the right. */
export function PageHeader({
  eyebrow,
  title,
  actions,
  nowrap = false,
}: {
  eyebrow: string;
  title: string;
  actions?: ReactNode;
  /** Keeps small actions, such as one icon button, on the title's row instead of wrapping under it on a phone. */
  nowrap?: boolean;
}) {
  return (
    <header className={cn("enter flex items-end justify-between gap-4 pt-2", nowrap ? "flex-nowrap" : "flex-wrap")}>
      <div className="min-w-0 space-y-2">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="text-[2rem] leading-[1.05] font-bold tracking-[-0.02em] font-stretch-[118%] text-chalk sm:text-[2.75rem]">
          {title}
        </h1>
      </div>
      {actions}
    </header>
  );
}
