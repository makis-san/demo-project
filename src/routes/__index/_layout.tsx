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
      className="w-full justify-start gap-3 text-slate-600">
      <LogOut className="w-4 h-4" />
      Log out
    </Button>
  );
}

function RouteComponent() {
  const { user } = Route.useRouteContext();
  return (
    <div className="min-h-screen flex bg-slate-50">
      <nav className="w-64 bg-white border-r border-slate-200 p-4 flex flex-col sticky top-0 h-screen shrink-0">
        <img src="/wordmark.svg" alt="Logo" className="h-6 mb-8" />
        <div className="flex flex-col gap-1 flex-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors [&.active]:bg-slate-100 [&.active]:text-slate-900">
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          ))}
        </div>
        <div className="border-t border-slate-200 pt-4 mt-4 space-y-2">
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-slate-600">
            <User className="w-4 h-4" />
            <div className="truncate">
              <p className="text-xs text-slate-400">Logged in as</p>
              <p className="font-medium truncate">{user.name || user.email}</p>
            </div>
          </div>
          <LogoutButton />
        </div>
      </nav>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
