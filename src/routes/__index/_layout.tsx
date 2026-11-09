import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Dumbbell, History, BicepsFlexed, Scale, LogOut, House, Library, UserRound } from "lucide-react";
import { currentWorkoutQueryOptions } from "./_layout.current-workout/-queries/current-workout";
import { useLogout } from "@/lib/use-logout";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/__index/_layout")({
  component: RouteComponent,
  beforeLoad: ({ context }) => {
    if (!context.user) throw redirect({ to: "/sign-in" });
    return { user: context.user! };
  },
});

// The sidebar (md and up) has every page. `also` lists the other paths a page lights up for: the Start screen is
// where a workout begins, so it lights the same item as the workout itself.
const sidebarItems = [
  { to: "/home", label: "Home", icon: House },
  { to: "/current-workout", also: ["/start-workout"], label: "Current Workout", icon: Dumbbell },
  { to: "/workout-library", label: "Workout Library", icon: Library },
  { to: "/workout-history", label: "Workout History", icon: History },
  { to: "/movements", label: "Movements", icon: BicepsFlexed },
  { to: "/body-weight", label: "Body Weight", icon: Scale },
  { to: "/account", label: "Account", icon: UserRound },
] as const;

// The phone's dock has five: the two libraries are one item, and the workout is the raised button in the middle.
// `short` is what shows under the icon. The link is still named by `label`, as hidden text rather than aria-label,
// so getByLabel("Weight") style lookups don't also match the Body Weight link.
const dockItems = [
  { to: "/home", label: "Home", short: "Home", icon: House },
  { to: "/workout-library", also: ["/movements"], label: "Library", short: "Library", icon: Library },
  { to: "/current-workout", also: ["/start-workout"], label: "Current Workout", short: "Workout", icon: Dumbbell },
  { to: "/workout-history", label: "Workout History", short: "History", icon: History },
  { to: "/body-weight", label: "Body Weight", short: "Weight", icon: Scale },
] as const;

const isOn = (pathname: string, item: { to: string; also?: readonly string[] }) =>
  [item.to, ...(item.also ?? [])].some((path) => pathname === path || pathname.startsWith(`${path}/`));

const sidebarLinkClass =
  "press relative flex h-11 items-center gap-3 rounded-2xl px-3.5 text-sm font-medium text-faint hover:text-chalk " +
  "data-[active=true]:bg-white/[0.08] data-[active=true]:text-chalk";

function LogoutButton() {
  const logout = useLogout();
  return (
    <button
      type="button"
      onClick={() => logout.mutate()}
      disabled={logout.isPending}
      className={`${sidebarLinkClass} w-full disabled:opacity-50`}>
      <LogOut className="h-[18px] w-[18px]" />
      Log out
    </button>
  );
}

function RouteComponent() {
  const { user } = Route.useRouteContext();
  const displayName = user.name || user.email;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // A workout in progress on its own page is a focus screen on a phone: the dock goes, and the page has its own top bar
  // and a bar for the set at the bottom. This reads the workout the page's loader put in the cache (it only observes,
  // it never fetches), so the server and the browser agree and the dock never flashes. From md up nothing hides.
  const { data: activeWorkout } = useQuery({ ...currentWorkoutQueryOptions(), enabled: false });
  const focus = !!activeWorkout && pathname.replace(/\/$/, "") === "/current-workout";
  return (
    <div className="min-h-dvh md:flex md:gap-6 md:p-4">
      {/* The sidebar, from md up. */}
      <nav
        aria-label="Main"
        className="glass glass-strong sticky top-4 hidden h-[calc(100dvh-2rem)] w-64 shrink-0 flex-col rounded-panel p-4 md:flex">
        <Link to="/" className="mb-10 px-2 pt-2" aria-label="Setlist home">
          <Logo />
        </Link>
        <div className="flex flex-1 flex-col gap-1">
          {sidebarItems.map((item) => {
            const active = isOn(pathname, item);
            return (
              <Link
                key={item.to}
                to={item.to}
                data-active={active}
                aria-current={active ? "page" : undefined}
                className={sidebarLinkClass}>
                {/* The marker is part of the highlight: a red tick at the left edge. */}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary"
                  />
                )}
                <item.icon className={cn("h-[18px] w-[18px]", active && "text-accent")} />
                {item.label}
              </Link>
            );
          })}
        </div>
        <div className="mt-4 space-y-1 border-t border-line pt-4">
          <div className="flex items-center gap-3 px-2 py-2">
            <span
              aria-hidden="true"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-accent uppercase">
              {displayName.charAt(0)}
            </span>
            <p className="min-w-0 truncate text-sm font-medium text-chalk">{displayName}</p>
          </div>
          <LogoutButton />
        </div>
      </nav>

      {/* The dock, below md: five items, the workout raised in the middle. */}
      <nav
        aria-label="Main"
        className={cn(
          "glass glass-strong fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 grid grid-cols-5 rounded-[1.5rem] px-1.5 pb-1.5 md:hidden",
          focus && "hidden",
        )}>
        {dockItems.map((item) => {
          const active = isOn(pathname, item);
          const main = item.to === "/current-workout";
          return (
            <Link
              key={item.to}
              to={item.to}
              data-active={active}
              aria-current={active ? "page" : undefined}
              className={cn(
                "press group relative flex flex-col items-center justify-end gap-1 pt-2.5 text-[11px] font-medium text-faint",
                "data-[active=true]:text-chalk",
                main ? "pb-0.5" : "pb-1",
              )}>
              {main ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "-mt-8 grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-ink shadow-[0_10px_26px_-6px_var(--color-primary)] ring-4 ring-ground transition-transform",
                    active && "ring-primary/30",
                  )}>
                  <item.icon className="h-6 w-6" />
                </span>
              ) : (
                <item.icon className="h-5 w-5 group-data-[active=true]:text-accent" />
              )}
              <span aria-hidden="true" className={cn(main && "text-chalk")}>
                {item.short}
              </span>
              <span className="sr-only">{item.label}</span>
              {!main && active && (
                <span
                  aria-hidden="true"
                  className="absolute top-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary"
                />
              )}
            </Link>
          );
        })}
      </nav>

      <main
        className={cn(
          "mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 pt-6 md:px-2 md:pt-8 md:pb-10",
          focus ? "max-md:pt-0 max-md:pb-0" : "pb-32",
        )}>
        <Outlet />
      </main>
    </div>
  );
}
