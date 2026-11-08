import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { Dumbbell, History, BicepsFlexed, Scale, User, LogOut } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { logoutServerFn } from "@/lib/auth.server";

export const Route = createFileRoute("/__index/_layout")({
  component: RouteComponent,
  beforeLoad: ({ context }) => {
    if (!context.user) throw redirect({ to: "/sign-in" });
    return { user: context.user! };
  },
});

const navItems = [
  { to: "/current-workout", label: "Current Workout", icon: Dumbbell },
  { to: "/workout-history", label: "Workout History", icon: History },
  { to: "/movements", label: "Movements", icon: BicepsFlexed },
  { to: "/body-weight", label: "Body Weight", icon: Scale },
] as const;

// The same links are a bar along the bottom on a phone and a sidebar from md up. The classes without a
// prefix are the phone, the md: ones put back what the sidebar had.
const navItemClass =
  "flex flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-center text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors [&.active]:bg-slate-100 [&.active]:text-slate-900 md:flex-none md:flex-row md:justify-start md:gap-3 md:px-3 md:text-left md:text-sm md:rounded-lg";

function LogoutButton() {
  const logoutMutation = useMutation({
    mutationFn: () => logoutServerFn(),
    // A full page load, not a client navigation, so nothing the last user saw stays in the browser's memory.
    onSuccess: () => window.location.assign("/sign-in"),
  });

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => logoutMutation.mutate()}
      disabled={logoutMutation.isPending}
      className="h-auto flex-1 flex-col gap-1 rounded-none px-1 py-2 text-[11px] text-slate-600 md:h-8 md:w-full md:flex-none md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-3 md:text-sm">
      <LogOut className="w-4 h-4" />
      Log out
    </Button>
  );
}

function RouteComponent() {
  const { user } = Route.useRouteContext();
  return (
    <div className="min-h-screen flex bg-slate-50">
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white md:sticky md:inset-x-auto md:top-0 md:bottom-auto md:z-auto md:h-screen md:w-64 md:shrink-0 md:flex-col md:border-r md:border-t-0 md:p-4">
        <img src="/wordmark.svg" alt="Logo" className="mb-8 hidden h-6 md:block" />
        <div className="flex flex-[4] md:flex-1 md:flex-col md:gap-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className={navItemClass}>
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          ))}
        </div>
        <div className="flex flex-1 md:mt-4 md:block md:flex-none md:space-y-2 md:border-t md:border-slate-200 md:pt-4">
          <div className="hidden items-center gap-3 px-3 py-2 text-sm text-slate-600 md:flex">
            <User className="w-4 h-4" />
            <div className="truncate">
              <p className="text-xs text-slate-400">Logged in as</p>
              <p className="font-medium truncate">{user.name || user.email}</p>
            </div>
          </div>
          <LogoutButton />
        </div>
      </nav>
      <main className="min-w-0 flex-1 p-4 pb-24 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
