import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { Dumbbell, History, BicepsFlexed, Scale, LogOut, House, Library } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { logoutServerFn } from "@/lib/auth.server";
import { Logo } from "@/components/logo";

export const Route = createFileRoute("/__index/_layout")({
  component: RouteComponent,
  beforeLoad: ({ context }) => {
    if (!context.user) throw redirect({ to: "/sign-in" });
    return { user: context.user! };
  },
});

// `short` is what fits under the icon in the phone's dock. The link is still named by `label`, as hidden text
// rather than aria-label, so getByLabel("Weight") style lookups don't also match the Body Weight link.
const navItems = [
  { to: "/home", label: "Home", short: "Home", icon: House },
  // The Start screen is where a workout begins, so it lights the same tab as the workout itself.
  { to: "/current-workout", also: "/start-workout", label: "Current Workout", short: "Workout", icon: Dumbbell },
  { to: "/workout-library", label: "Workout Library", short: "Library", icon: Library },
  { to: "/workout-history", label: "Workout History", short: "History", icon: History },
  { to: "/movements", label: "Movements", short: "Moves", icon: BicepsFlexed },
  { to: "/body-weight", label: "Body Weight", short: "Weight", icon: Scale },
] as const;

// The same links are a floating dock along the bottom on a phone and a floating sidebar from md up. The classes
// without a prefix are the phone, the md: ones are the sidebar.
const navItemClass =
  "press group relative flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[11px] font-medium text-faint hover:text-chalk " +
  "[&.active]:text-chalk " +
  "md:h-11 md:flex-none md:flex-row md:justify-start md:gap-3 md:px-3.5 md:py-0 md:text-sm";

function LogoutButton() {
  const logoutMutation = useMutation({
    mutationFn: () => logoutServerFn(),
    // A full page load, not a client navigation, so nothing the last user saw stays in the browser's memory.
    onSuccess: () => window.location.assign("/sign-in"),
  });

  return (
    <button
      type="button"
      onClick={() => logoutMutation.mutate()}
      disabled={logoutMutation.isPending}
      className={`${navItemClass} disabled:opacity-50 md:w-full`}>
      <LogOut className="h-[18px] w-[18px]" />
      Log out
    </button>
  );
}

function RouteComponent() {
  const { user } = Route.useRouteContext();
  const displayName = user.name || user.email;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const activeIndex = navItems.findIndex(
    (item) => pathname.startsWith(item.to) || ("also" in item && pathname.startsWith(item.also)),
  );
  return (
    <div className="min-h-dvh md:flex md:gap-6 md:p-4">
      <nav
        aria-label="Main"
        className="glass glass-strong fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 flex rounded-[1.5rem] p-1.5 md:sticky md:inset-x-auto md:top-4 md:bottom-auto md:h-[calc(100dvh-2rem)] md:w-64 md:shrink-0 md:flex-col md:rounded-panel md:p-4">
        <Link to="/" className="mb-10 hidden px-2 pt-2 md:block" aria-label="Setlist home">
          <Logo />
        </Link>
        <p className="eyebrow mb-3 hidden px-3.5 md:block">Train</p>
        <div className="relative flex flex-[6] md:flex-1 md:flex-col">
          {/* One highlight that slides to the page you open. The links are all the same size, so the page's
              position in the list is all it needs: across the dock on a phone, down the sidebar from md up. */}
          {activeIndex >= 0 && (
            <span
              aria-hidden="true"
              style={{ "--i": activeIndex, "--n": navItems.length } as React.CSSProperties}
              className="pointer-events-none absolute inset-y-0 left-0 w-[calc(100%/var(--n))] translate-x-[calc(var(--i)*100%)] rounded-2xl bg-white/[0.08] transition-transform duration-[380ms] ease-[var(--ease-enter)] motion-reduce:transition-none md:inset-x-0 md:top-0 md:bottom-auto md:h-11 md:w-full md:translate-x-0 md:translate-y-[calc(var(--i)*100%)]">
              <span className="absolute top-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary md:top-1/2 md:left-0 md:h-5 md:w-[3px] md:translate-x-0 md:-translate-y-1/2" />
            </span>
          )}
          {navItems.map(({ to, label, short, icon: Icon }) => (
            <Link key={to} to={to} className={navItemClass}>
              <Icon className="h-[18px] w-[18px] group-[.active]:text-accent" />
              <span aria-hidden="true" className="md:hidden">
                {short}
              </span>
              {/* The full name is the link's name everywhere, and only shown from md up. */}
              <span className="sr-only md:not-sr-only">{label}</span>
            </Link>
          ))}
        </div>
        <div className="flex flex-1 md:mt-4 md:block md:flex-none md:space-y-1 md:border-t md:border-line md:pt-4">
          <div className="hidden items-center gap-3 px-2 py-2 md:flex">
            <span
              aria-hidden="true"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-accent uppercase">
              {displayName.charAt(0)}
            </span>
            <div className="min-w-0">
              <p className="eyebrow">Signed in</p>
              <p className="truncate text-sm font-medium text-chalk">{displayName}</p>
            </div>
          </div>
          <LogoutButton />
        </div>
      </nav>
      <main className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 pt-6 pb-32 md:px-2 md:pt-8 md:pb-10">
        <Outlet />
      </main>
    </div>
  );
}
