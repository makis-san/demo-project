import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FieldLabel, FormError } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { deleteAccountServerFn } from "@/lib/account-settings.server";
import { errorMessage } from "@/lib/error-message";

/**
 * Deleting the account takes two steps in the page: "Delete account" opens the confirmation, which asks for the
 * password and says what will go. There is no window.confirm: it is a browser dialog the page cannot style, and
 * it blocks automated tests.
 */
export function DeleteCard() {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const remove = useMutation({
    mutationFn: () => deleteAccountServerFn({ data: { password } }),
    onSuccess: (result) => {
      if (!result.success) return setError(result.error);
      // A full page load, like logging out, so nothing of the account stays in the browser's memory.
      window.location.assign("/sign-in");
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  const cancel = () => {
    setConfirming(false);
    setPassword("");
    setError("");
  };

  return (
    <Card className="enter enter-3 border-danger/30 p-3 sm:p-4">
      <div className="space-y-5 p-2">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-chalk font-stretch-[112%]">Delete account</h2>
          <p className="text-sm text-muted">
            Deletes your workouts, sets, movements, body weights, workout library and every signed-in device. This can't
            be undone.
          </p>
        </div>

        {!confirming ? (
          <Button variant="destructive" onClick={() => setConfirming(true)}>
            Delete account
          </Button>
        ) : (
          <form
            role="group"
            aria-label="Confirm account deletion"
            onSubmit={(event) => {
              event.preventDefault();
              setError("");
              remove.mutate();
            }}
            className="space-y-4 rounded-2xl border border-danger/30 bg-danger/10 p-4">
            <p className="text-sm text-chalk">Enter your password to delete everything.</p>
            {error && <FormError>{error}</FormError>}
            <div className="space-y-2">
              <FieldLabel htmlFor="delete-password">Password</FieldLabel>
              <Input
                id="delete-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                maxLength={128}
                autoComplete="current-password"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="destructive" disabled={remove.isPending}>
                {remove.isPending ? "Deleting..." : "Delete everything"}
              </Button>
              <Button type="button" variant="ghost" onClick={cancel} disabled={remove.isPending}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
