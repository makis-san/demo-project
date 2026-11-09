import { Link } from "@tanstack/react-router";
import { LogOut, UserRound } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useLogout } from "@/lib/use-logout";

/**
 * The account on a phone: a round button with the user's initial that opens who is signed in, the Account page and
 * Log out. The dock has no room for Account, and the sidebar has both from md up, so this is hidden there.
 */
export function AccountMenu({ name, email }: { name: string | null; email: string }) {
  const logout = useLogout();
  const label = name || email;
  return (
    <div className="relative md:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Account"
          aria-haspopup="dialog"
          className="press grid h-10 w-10 place-items-center rounded-full border border-line-strong bg-primary/15 text-sm font-semibold text-accent uppercase">
          {label.charAt(0)}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" role="group" aria-label="Account" sideOffset={8} className="w-60 p-3">
          <div className="min-w-0 px-1 pb-3">
            {name && <p className="truncate text-sm font-semibold text-chalk">{name}</p>}
            <p className="truncate text-sm text-muted">{email}</p>
          </div>
          <Link to="/account" className={buttonClasses({ variant: "outline", className: "mb-2 w-full" })}>
            <UserRound className="h-4 w-4" />
            Account settings
          </Link>
          <Button variant="outline" className="w-full" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogOut className="h-4 w-4" />
            Log out
          </Button>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
