import { cn } from "@/lib/utils";

/** The three-bar mark: a set list getting shorter as the session goes. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={cn("h-8 w-8", className)} aria-hidden="true">
      <rect width="36" height="36" rx="11" className="fill-primary" />
      <rect x="8" y="9" width="20" height="4" rx="2" className="fill-primary-ink" />
      <rect x="8" y="16" width="14" height="4" rx="2" className="fill-primary-ink" />
      <rect x="8" y="23" width="8" height="4" rx="2" className="fill-primary-ink" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-xl font-bold tracking-tight font-stretch-[125%] text-chalk">Setlist</span>
    </span>
  );
}
