import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * The top of a signed-in page: the page's h1, an optional line of context under it, and its actions on the right.
 * The context is normal case and only there when it says something, like a date or a start time.
 */
export function PageHeader({
  context,
  title,
  actions,
  nowrap = false,
  className,
}: {
  context?: string;
  title: string;
  actions?: ReactNode;
  /** Keeps small actions, such as one icon button, on the title's row instead of wrapping under it on a phone. */
  nowrap?: boolean;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "enter flex items-end justify-between gap-4 pt-1",
        nowrap ? "flex-nowrap" : "flex-wrap",
        className,
      )}>
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl leading-[1.1] font-bold tracking-[-0.02em] font-stretch-[112%] text-chalk sm:text-[2.75rem] sm:font-stretch-[118%]">
          {title}
        </h1>
        {context && <p className="num text-sm text-muted">{context}</p>}
      </div>
      {actions}
    </header>
  );
}
