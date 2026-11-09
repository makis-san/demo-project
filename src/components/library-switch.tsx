import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const tabClass =
  "press flex h-10 flex-1 items-center justify-center rounded-full text-sm font-semibold text-faint hover:text-chalk";

/**
 * On a phone the two libraries share one dock item, so this switch sits at the top of each: Workouts or Movements.
 * From md up the sidebar has both pages, and this is hidden.
 */
export function LibrarySwitch({ current }: { current: "workouts" | "movements" }) {
  const on = (key: typeof current) => current === key;
  return (
    <nav aria-label="Library" className="enter flex gap-1 rounded-full bg-black/25 p-1 md:hidden">
      <Link
        to="/workout-library"
        aria-current={on("workouts") ? "page" : undefined}
        className={cn(tabClass, on("workouts") && "bg-white/[0.12] text-chalk")}>
        Workouts
      </Link>
      <Link
        to="/movements"
        aria-current={on("movements") ? "page" : undefined}
        className={cn(tabClass, on("movements") && "bg-white/[0.12] text-chalk")}>
        Movements
      </Link>
    </nav>
  );
}
